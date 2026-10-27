import { Area } from '../models/area.model.js';
import { User } from '../models/user.model.js';
import { Requisicion } from '../models/requisicion.model.js';
import { PresupuestoArea } from '../models/presupuestoArea.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';
import { buildPagination } from '../utils/pagination.util.js';

const normalizeCodigo = (codigo) => String(codigo).trim().toUpperCase();

function mapDuplicateKey(err) {
  if (err && err.code === 11000) {
    const key = JSON.stringify(err.keyPattern || err.keyValue || {});
    return key.includes('codigo')
      ? new ApiError(409, 'Ya existe un área con ese código', 'DUPLICATE_AREA_CODE')
      : new ApiError(409, 'Ya existe un área con ese nombre', 'DUPLICATE_AREA');
  }
  return err;
}

export class AreaService {
  /** 409 DUPLICATE_AREA_CODE / DUPLICATE_AREA when the code or the name (ignoring case) is taken by a non-deleted area. */
  async assertUnique(tenantId, { codigo, nombre }, excludeId = null) {
    const exclude = excludeId ? { _id: { $ne: excludeId } } : {};
    if (codigo !== undefined) {
      const dup = await Area.findOne(applyTenantFilter({ codigo: normalizeCodigo(codigo), ...exclude }, tenantId)).select('_id').lean();
      if (dup) throw new ApiError(409, 'Ya existe un área con ese código', 'DUPLICATE_AREA_CODE', { codigo });
    }
    if (nombre !== undefined) {
      const dup = await Area.findOne(applyTenantFilter({
        nombre: { $regex: `^${escapeRegex(String(nombre).trim())}$`, $options: 'i' },
        ...exclude,
      }, tenantId)).select('_id').lean();
      if (dup) throw new ApiError(409, 'Ya existe un área con ese nombre', 'DUPLICATE_AREA', { nombre });
    }
  }

  /** Heads must be live users of the SAME tenant (400 JEFE_INVALIDO). Returns the de-duplicated ids. */
  async assertJefes(tenantId, jefesIds = []) {
    const ids = [...new Set((jefesIds || []).map(String))];
    if (ids.length === 0) return [];
    const found = await User.find({ _id: { $in: ids }, tenantId }).select('_id').lean();
    if (found.length !== ids.length) {
      throw new ApiError(400, 'Uno o más jefes no pertenecen a la organización', 'JEFE_INVALIDO');
    }
    return ids;
  }

  async create(tenantId, data) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = data;
    await this.assertUnique(tenantId, { codigo: clean.codigo, nombre: clean.nombre });
    const jefesIds = await this.assertJefes(tenantId, clean.jefesIds);
    try {
      const area = await Area.create({ ...clean, codigo: normalizeCodigo(clean.codigo), jefesIds, tenantId });
      logger.info('Area creada: ' + area._id);
      return area;
    } catch (err) {
      throw mapDuplicateKey(err);
    }
  }

  async list(tenantId, filters = {}, pagination = {}) {
    requireTenant(tenantId);
    const { page = 1, limit = 10, sortBy = 'nombre', order = 'asc' } = pagination;
    const query = applyTenantFilter({}, tenantId);
    if (filters.activa !== undefined) query.activa = filters.activa;
    if (filters.search) {
      const rx = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [{ nombre: rx }, { codigo: rx }];
    }
    const sort = { [sortBy]: order === 'desc' ? -1 : 1 };
    if (sortBy !== 'nombre') sort.nombre = 1;
    const [data, total] = await Promise.all([
      Area.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Area.countDocuments({ ...query, isDeleted: { $ne: true } }),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  }

  async getById(tenantId, id) {
    requireTenant(tenantId);
    const area = await Area.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!area) throw new ApiError(404, 'Área no encontrada', 'AREA_NOT_FOUND', { id });
    return area;
  }

  /**
   * Area that a requisition (or a user) may point to: it must exist in the tenant and be active.
   * 400 AREA_INVALIDA otherwise (also when it belongs to another tenant).
   */
  async assertAreaActiva(tenantId, areaId) {
    requireTenant(tenantId);
    const area = await Area.findOne(applyTenantFilter({ _id: areaId, activa: true }, tenantId)).lean();
    if (!area) throw new ApiError(400, 'El área no existe o está inactiva', 'AREA_INVALIDA', { areaId });
    return area;
  }

  async update(tenantId, id, data) {
    requireTenant(tenantId);
    const { tenantId: _t, codigo: _c, ...clean } = data;
    if (clean.nombre !== undefined) await this.assertUnique(tenantId, { nombre: clean.nombre }, id);
    if (clean.jefesIds !== undefined) clean.jefesIds = await this.assertJefes(tenantId, clean.jefesIds);
    let area;
    try {
      area = await Area.findOneAndUpdate(
        applyTenantFilter({ _id: id }, tenantId),
        { $set: clean },
        { new: true, runValidators: true },
      );
    } catch (err) {
      throw mapDuplicateKey(err);
    }
    if (!area) throw new ApiError(404, 'Área no encontrada', 'AREA_NOT_FOUND', { id });
    logger.info('Area actualizada: ' + id);
    return area;
  }

  /** Soft delete. An area referenced by users, requisitions or budgets cannot be deleted (409 AREA_EN_USO): deactivate it. */
  async delete(tenantId, id) {
    requireTenant(tenantId);
    const exists = await Area.exists(applyTenantFilter({ _id: id }, tenantId));
    if (!exists) throw new ApiError(404, 'Área no encontrada', 'AREA_NOT_FOUND', { id });
    const [usuarios, requisiciones, presupuestos] = await Promise.all([
      User.countDocuments({ tenantId, areaId: id }),
      Requisicion.countDocuments({ tenantId, areaId: id }).setOptions({ includeDeleted: true }),
      PresupuestoArea.countDocuments({ tenantId, areaId: id, isDeleted: { $ne: true } }),
    ]);
    if (usuarios + requisiciones + presupuestos > 0) {
      throw new ApiError(
        409,
        'El área está en uso (usuarios, requisiciones o presupuestos); solo puede desactivarse',
        'AREA_EN_USO',
        { usuarios, requisiciones, presupuestos },
      );
    }
    const area = await Area.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
    if (!area) throw new ApiError(404, 'Área no encontrada', 'AREA_NOT_FOUND', { id });
    logger.info('Area eliminada (soft): ' + id);
  }
}

export const areaService = new AreaService();
