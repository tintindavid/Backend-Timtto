import { ReglaAprobacion } from '../models/reglaAprobacion.model.js';
import { Role } from '../models/role.model.js';
import { Area } from '../models/area.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { stripEsSistema, assertNotSistema, assertSistemaUpdate } from '../utils/registroSistema.util.js';
import { buildPagination } from '../utils/pagination.util.js';
import { roundMoney } from '../utils/money.util.js';
import { APROBADOR_TIPO } from '../constants/requisicion.constants.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { eligibleIdsForRule, usersWithApprove, assertLevelsFeasible } from './requisicionEligibility.service.js';
import { findDistinctAssignment } from '../utils/approverAssignment.util.js';

const upper = (hasta) => (hasta === null || hasta === undefined ? Infinity : hasta);

/**
 * Pure consistency check of ONE active rule against the other active rules of the tenant (design D6):
 *  - ORDEN_DUPLICADO: two active rules share the same `orden`;
 *  - TRASLAPE: their half-open ranges [montoDesde, montoHasta) overlap (null = no upper limit);
 *  - ORDEN_INCONSISTENTE: the level with the larger `montoDesde` must have the larger `orden`;
 *  - RANGO_INVALIDO: montoHasta <= montoDesde.
 *
 * @returns {{ tipo: string, reglaId?: string, orden?: number }[]} conflicts (empty when consistent)
 */
export function findReglaConflicts(candidate, others = []) {
  const conflicts = [];
  const desde = candidate.montoDesde;
  const hasta = upper(candidate.montoHasta);
  if (hasta <= desde) conflicts.push({ tipo: 'RANGO_INVALIDO' });
  for (const o of others) {
    const ref = { reglaId: String(o._id), orden: o.orden };
    if (o.orden === candidate.orden) conflicts.push({ tipo: 'ORDEN_DUPLICADO', ...ref });
    if (desde < upper(o.montoHasta) && o.montoDesde < hasta) conflicts.push({ tipo: 'TRASLAPE', ...ref });
    if ((desde < o.montoDesde && candidate.orden > o.orden) || (desde > o.montoDesde && candidate.orden < o.orden)) {
      conflicts.push({ tipo: 'ORDEN_INCONSISTENTE', ...ref });
    }
  }
  return conflicts;
}

export class ReglaAprobacionService {
  /** Throws 400 REGLAS_INCONSISTENTES when the (active) candidate conflicts with the tenant's other active rules. */
  async assertConsistent(tenantId, candidate, excludeId = null) {
    if (candidate.activo === false) return;
    const query = applyTenantFilter({ activo: true }, tenantId);
    if (excludeId) query._id = { $ne: excludeId };
    const others = await ReglaAprobacion.find(query).lean();
    const conflicts = findReglaConflicts(candidate, others);
    if (conflicts.length > 0) {
      throw new ApiError(400, 'Las reglas de aprobación son inconsistentes (traslape de montos o orden incoherente)', 'REGLAS_INCONSISTENTES', { conflicts });
    }
  }

  /**
   * Approver data must match the type and reference live records of the same tenant, and every approver must hold
   * `requisiciones:approve` (both decision endpoints require it): role (400 ROL_SIN_PERMISO_APROBAR) or listed users
   * (400 APROBADOR_SIN_PERMISO). `jefe_area` heads are checked at send time and reported as warnings.
   */
  async assertApprover(tenantId, { aprobadorTipo, rolId, usuariosIds }) {
    if (aprobadorTipo === APROBADOR_TIPO.ROL) {
      if (!rolId) throw new ApiError(400, 'Una regla de tipo rol requiere un rol del tenant', 'ROL_INVALIDO');
      const role = await Role.findOne({ _id: rolId, tenantId }).select('_id permissions').lean();
      if (!role) throw new ApiError(400, 'El rol no existe en la organización', 'ROL_INVALIDO', { rolId });
      if (!(role.permissions || []).includes(PERMISSIONS.REQUISICIONES_APPROVE)) {
        throw new ApiError(400, 'El rol no tiene el permiso de aprobar requisiciones', 'ROL_SIN_PERMISO_APROBAR', { rolId });
      }
    }
    if (aprobadorTipo === APROBADOR_TIPO.USUARIOS) {
      const ids = [...new Set((usuariosIds || []).map(String))];
      if (ids.length === 0) throw new ApiError(400, 'Una regla de tipo usuarios requiere al menos un usuario', 'USUARIO_INVALIDO');
      const found = await User.find({ _id: { $in: ids }, tenantId }).select('_id').lean();
      if (found.length !== ids.length) {
        throw new ApiError(400, 'Uno o más usuarios no pertenecen a la organización', 'USUARIO_INVALIDO');
      }
      const allowed = new Set(await usersWithApprove(tenantId, ids));
      const sinPermiso = ids.filter((u) => !allowed.has(u));
      if (sinPermiso.length > 0) {
        throw new ApiError(400, 'Uno o más usuarios no tienen el permiso de aprobar requisiciones', 'APROBADOR_SIN_PERMISO', { usuarios: sinPermiso });
      }
    }
  }

  /** montoHasta (when finite) must be greater than montoDesde; checked on the MERGED values (create and update). */
  assertRange({ montoDesde, montoHasta }) {
    if (montoHasta !== null && montoHasta !== undefined && !(montoHasta > montoDesde)) {
      throw new ApiError(400, 'montoHasta debe ser mayor que montoDesde', 'RANGO_INVALIDO', { montoDesde, montoHasta });
    }
  }

  /**
   * Every ACTIVE level whose approvers do not depend on the requisition (`rol`, `usuarios`) must get a DISTINCT
   * eligible approver (422 NIVEL_SIN_APROBADOR_ELEGIBLE with the offending levels). `jefe_area` levels depend on the
   * requisition's area and are validated at send time.
   */
  async assertApproversFeasible(tenantId, candidate, excludeId = null) {
    if (candidate.activo === false) return;
    const query = applyTenantFilter({ activo: true }, tenantId);
    if (excludeId) query._id = { $ne: excludeId };
    const others = await ReglaAprobacion.find(query).lean();
    const levels = [];
    for (const r of [...others, candidate]) {
      if (r.aprobadorTipo === APROBADOR_TIPO.JEFE_AREA) continue;
      levels.push({ orden: r.orden, nombre: r.nombre, ids: await eligibleIdsForRule(tenantId, r, null) });
    }
    assertLevelsFeasible(levels);
  }

  /**
   * Non-blocking diagnostics for the rules screen: configurations that would make a requisition undecidable.
   * @returns {Promise<{ tipo: string, mensaje: string, nivelOrden?: number }[]>}
   */
  async getWarnings(tenantId) {
    requireTenant(tenantId);
    const warnings = [];
    const reglas = await ReglaAprobacion.find(applyTenantFilter({ activo: true }, tenantId)).sort({ orden: 1 }).lean();
    if (reglas.some((r) => r.aprobadorTipo === APROBADOR_TIPO.JEFE_AREA)) {
      const areas = await Area.find(applyTenantFilter({ activa: true }, tenantId)).lean();
      for (const area of areas) {
        const jefes = (area.jefesIds || []).map(String);
        const allowed = new Set(await usersWithApprove(tenantId, jefes));
        const sinPermiso = jefes.filter((j) => !allowed.has(j));
        if (jefes.length === 0 || sinPermiso.length > 0) {
          const sinJefe = jefes.length === 0;
          warnings.push({
            tipo: sinJefe ? 'AREA_SIN_JEFE_APROBADOR' : 'JEFE_SIN_PERMISO_APROBAR',
            mensaje: sinJefe
              ? `El área "${area.nombre}" no tiene jefe: las requisiciones de esa área no podrán enviarse a aprobación en los niveles de tipo jefe de área`
              : `El área "${area.nombre}" tiene jefes sin el permiso de aprobar requisiciones (${sinPermiso.length}): no contarán como aprobadores`,
            areaId: String(area._id),
            area: area.nombre,
            usuarios: sinPermiso,
          });
        }
      }
    }
    const levels = [];
    for (const r of reglas) {
      if (r.aprobadorTipo === APROBADOR_TIPO.JEFE_AREA) continue;
      const ids = await eligibleIdsForRule(tenantId, r, null);
      levels.push({ key: r.orden, ids, nombre: r.nombre });
      if (ids.length === 0) {
        warnings.push({
          tipo: 'NIVEL_SIN_APROBADORES',
          mensaje: `El nivel ${r.orden} "${r.nombre}" no tiene ningún aprobador elegible (se requiere el permiso de aprobar requisiciones)`,
          nivelOrden: r.orden,
          orden: r.orden,
          nombre: r.nombre,
        });
      }
    }
    const result = findDistinctAssignment(levels);
    if (!result.feasible) {
      const byKey = new Map(levels.map((l) => [l.key, l]));
      const niveles = result.offending.map((orden) => ({ orden, nombre: byKey.get(orden)?.nombre }));
      warnings.push({
        tipo: 'NIVELES_SIN_APROBADOR_DISTINTO',
        mensaje: `Los niveles ${niveles.map((n) => `${n.orden} "${n.nombre}"`).join(', ')} no pueden tener un aprobador distinto cada uno (una misma persona no puede decidir dos niveles)`,
        nivelOrden: niveles[0]?.orden,
        niveles,
      });
    }
    return warnings;
  }

  /** Keeps only the approver fields that apply to the type. */
  shapeApprover({ aprobadorTipo, rolId, usuariosIds }) {
    return {
      aprobadorTipo,
      rolId: aprobadorTipo === APROBADOR_TIPO.ROL ? rolId : null,
      usuariosIds: aprobadorTipo === APROBADOR_TIPO.USUARIOS ? [...new Set((usuariosIds || []).map(String))] : [],
    };
  }

  async create(tenantId, data) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = stripEsSistema(data);
    const rule = {
      orden: clean.orden,
      nombre: clean.nombre,
      montoDesde: roundMoney(clean.montoDesde),
      montoHasta: clean.montoHasta === null || clean.montoHasta === undefined ? null : roundMoney(clean.montoHasta),
      activo: clean.activo !== false,
      ...this.shapeApprover(clean),
    };
    this.assertRange(rule);
    await this.assertApprover(tenantId, rule);
    await this.assertConsistent(tenantId, rule);
    await this.assertApproversFeasible(tenantId, rule);
    const created = await ReglaAprobacion.create({ ...rule, tenantId });
    logger.info('ReglaAprobacion creada: ' + created._id);
    return created;
  }

  async list(tenantId, filters = {}, pagination = {}) {
    requireTenant(tenantId);
    const { page = 1, limit = 50 } = pagination;
    const query = applyTenantFilter({}, tenantId);
    if (filters.activo !== undefined) query.activo = filters.activo;
    const [data, total] = await Promise.all([
      ReglaAprobacion.find(query).sort({ orden: 1, montoDesde: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      ReglaAprobacion.countDocuments({ ...query, isDeleted: { $ne: true } }),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  }

  async getById(tenantId, id) {
    requireTenant(tenantId);
    const rule = await ReglaAprobacion.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!rule) throw new ApiError(404, 'Regla de aprobación no encontrada', 'REGLA_NOT_FOUND', { id });
    return rule;
  }

  async update(tenantId, id, data) {
    requireTenant(tenantId);
    const current = await ReglaAprobacion.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!current) throw new ApiError(404, 'Regla de aprobación no encontrada', 'REGLA_NOT_FOUND', { id });
    const { tenantId: _t, ...clean } = stripEsSistema(data);
    assertSistemaUpdate(current, clean, { activeField: 'activo' });
    const merged = {
      orden: clean.orden ?? current.orden,
      nombre: clean.nombre ?? current.nombre,
      montoDesde: roundMoney(clean.montoDesde ?? current.montoDesde),
      montoHasta: clean.montoHasta === undefined
        ? current.montoHasta
        : (clean.montoHasta === null ? null : roundMoney(clean.montoHasta)),
      activo: clean.activo ?? current.activo,
      ...this.shapeApprover({
        aprobadorTipo: clean.aprobadorTipo ?? current.aprobadorTipo,
        rolId: clean.rolId === undefined ? current.rolId : clean.rolId,
        usuariosIds: clean.usuariosIds === undefined ? current.usuariosIds : clean.usuariosIds,
      }),
    };
    this.assertRange(merged);
    // Approver checks only when the approver changes (type / role / users) or the rule is being re-activated: a rule
    // that went stale (its role lost the permission...) must still be deactivable and renamable (N4).
    const ids = (list) => [...(list || [])].map(String).sort().join(',');
    const approverChanged = merged.aprobadorTipo !== current.aprobadorTipo
      || String(merged.rolId ?? '') !== String(current.rolId ?? '')
      || ids(merged.usuariosIds) !== ids(current.usuariosIds);
    const reactivated = merged.activo !== false && current.activo === false;
    const checkApprover = approverChanged || reactivated;
    if (checkApprover) await this.assertApprover(tenantId, merged);
    await this.assertConsistent(tenantId, merged, id);
    if (checkApprover) await this.assertApproversFeasible(tenantId, merged, id);
    // The range was validated above on the merged values (the model has no path validator that depends on `this`).
    const updated = await ReglaAprobacion.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: merged },
      { new: true, runValidators: true },
    );
    if (!updated) throw new ApiError(404, 'Regla de aprobación no encontrada', 'REGLA_NOT_FOUND', { id });
    logger.info('ReglaAprobacion actualizada: ' + id);
    return updated;
  }

  /** Soft delete. Requisitions already in approval keep their frozen snapshot of the levels. */
  async delete(tenantId, id) {
    requireTenant(tenantId);
    const current = await ReglaAprobacion.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!current) throw new ApiError(404, 'Regla de aprobación no encontrada', 'REGLA_NOT_FOUND', { id });
    assertNotSistema(current);
    const rule = await ReglaAprobacion.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
    if (!rule) throw new ApiError(404, 'Regla de aprobación no encontrada', 'REGLA_NOT_FOUND', { id });
    logger.info('ReglaAprobacion eliminada (soft): ' + id);
  }
}

export const reglaAprobacionService = new ReglaAprobacionService();
