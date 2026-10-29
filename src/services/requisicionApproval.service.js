import { Requisicion, buildTimelineEvent } from '../models/requisicion.model.js';
import { ReglaAprobacion } from '../models/reglaAprobacion.model.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { findDistinctAssignment } from '../utils/approverAssignment.util.js';
import { eligibleIdsForRule, usersWithApprove, assertLevelsFeasible } from './requisicionEligibility.service.js';
import { atomicWrite, transition } from './requisicionTransition.service.js';
import { notifyRequisicion, currentPendingLevel } from './requisicionNotify.service.js';
import { syncRequisicionSolicitudesSafe } from './requisicionSolicitudSync.service.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  APROBADOR_TIPO,
  NIVEL_ESTADO,
  REQUISICION_ESTADO,
  REQUISICION_EVENTO,
} from '../constants/requisicion.constants.js';

const sid = (v) => (v === null || v === undefined ? '' : String(v));

/** Legacy documents without `version` count as version 1. */
const versionFilter = (v) => (v === 1 ? { version: { $in: [1, null] } } : { version: v });

const plain = (nivel) => (nivel && typeof nivel.toObject === 'function' ? nivel.toObject() : { ...nivel });

/**
 * Approval engine (design D6, D7, D8).
 *  - resolveLevels: cumulative levels frozen at submission.
 *  - approve / reject: sequential decision with separation of duties, guarded by `aprobacion.nivelActual`.
 */
export class RequisicionApprovalService {
  /**
   * Users eligible for a rule, BEFORE excluding creator/requester: live users of the tenant that hold
   * `requisiciones:approve` (area heads of the requisition's area, listed users, or members of the rule's role).
   */
  async _eligibleIds(tenantId, regla, areaId) {
    return eligibleIdsForRule(tenantId, regla, areaId);
  }

  /**
   * Cumulative resolution: each ACTIVE rule with `montoDesde <= montoEstimado` adds a level, ordered by `orden`
   * (`montoHasta` is informational: validated at configuration time, not a resolution cut-off). Throws 422
   * before any state change when no rule applies or a level has no eligible approver (excluding creator/requester).
   *
   * @returns {Promise<object[]>} frozen levels (`estado: Pendiente`) ready to be stored in `aprobacion.niveles`
   */
  async resolveLevels(tenantId, requisicion) {
    requireTenant(tenantId);
    const reglas = await ReglaAprobacion.find({ tenantId, activo: true }).sort({ orden: 1 }).lean();
    const monto = Number(requisicion.montoEstimado) || 0;
    const aplicables = reglas
      .filter((r) => r.activo !== false && Number(r.montoDesde) <= monto)
      .sort((a, b) => a.orden - b.orden);
    if (aplicables.length === 0) {
      throw new ApiError(422, 'No hay reglas de aprobación activas aplicables al monto de la requisición', 'SIN_REGLAS_APROBACION', { montoEstimado: monto });
    }
    const excluded = new Set([sid(requisicion.creadaPor), sid(requisicion.solicitanteId)]);
    const eligibles = [];
    for (const regla of aplicables) {
      const ids = (await this._eligibleIds(tenantId, regla, requisicion.areaId)).filter((id) => !excluded.has(id));
      eligibles.push({ regla, ids });
    }
    // Every level needs a DISTINCT eligible approver (a person decides only one level of a requisition), otherwise a
    // later level would be undecidable once he decided an earlier one (422 before any change).
    assertLevelsFeasible(eligibles.map(({ regla, ids }) => ({ orden: regla.orden, nombre: regla.nombre, ids })), ', y no pueden ser el creador ni el solicitante');
    const niveles = eligibles.map(({ regla, ids }) => ({
      orden: regla.orden,
      nombre: regla.nombre,
      reglaId: regla._id,
      aprobadorTipo: regla.aprobadorTipo,
      rolId: regla.aprobadorTipo === APROBADOR_TIPO.ROL ? regla.rolId : null,
      usuariosIds: regla.aprobadorTipo === APROBADOR_TIPO.USUARIOS ? regla.usuariosIds || [] : [],
      montoDesde: regla.montoDesde,
      // Informational authority limit: it is NOT enforced at resolution (a requisition above the top limit gets the
      // same levels). Documented decision, see docs/requisiciones.md.
      montoHasta: regla.montoHasta ?? null,
      // `rol` levels are verified live at decision time; the others keep the ids resolved now.
      aprobadorIds: regla.aprobadorTipo === APROBADOR_TIPO.ROL ? [] : ids,
      estado: NIVEL_ESTADO.PENDIENTE,
      decididoPor: null,
      fecha: null,
    }));
    return niveles;
  }

  /** Live eligibility of `userId` for a frozen level. */
  async isEligible(tenantId, nivel, userId) {
    if ((nivel.aprobadorIds || []).map(sid).includes(sid(userId))) return true;
    if (nivel.aprobadorTipo === APROBADOR_TIPO.ROL && nivel.rolId) {
      const user = await User.findOne({ _id: userId, tenantId }).select('roleId').lean();
      if (!user || sid(user.roleId) !== sid(nivel.rolId)) return false;
      const role = await Role.findOne({ _id: nivel.rolId, tenantId }).lean();
      return Boolean(role && (role.permissions || []).includes(PERMISSIONS.REQUISICIONES_APPROVE));
    }
    return false;
  }

  /**
   * Loads the requisition and checks that it is waiting for a decision from `actorId`.
   * Order: state (409) -> content version (409) -> separation of duties (403 SEPARACION_FUNCIONES) -> eligibility (403).
   */
  async _loadForDecision(tenantId, id, actorId, version) {
    const doc = await Requisicion.findOne({ _id: id, tenantId });
    if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
    if (doc.estado !== REQUISICION_ESTADO.EN_APROBACION) {
      throw new ApiError(409, `La requisición está en estado ${doc.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
    // The decision is bound to the content the approver saw (no mutation on mismatch).
    if (version !== (doc.version ?? 1)) {
      throw new ApiError(409, 'La requisición cambió desde que la abriste; recárgala para ver el contenido actual', 'VERSION_DESACTUALIZADA', {
        versionActual: doc.version ?? 1,
        versionRecibida: version,
      });
    }
    const niveles = (doc.aprobacion?.niveles || []).map(plain);
    const nivel = niveles.find((n) => n.orden === doc.aprobacion.nivelActual && n.estado === NIVEL_ESTADO.PENDIENTE);
    if (!nivel) {
      throw new ApiError(409, 'La requisición no tiene un nivel de aprobación pendiente', 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
    if (sid(doc.creadaPor) === sid(actorId) || sid(doc.solicitanteId) === sid(actorId)) {
      throw new ApiError(403, 'No puedes decidir una requisición que creaste o solicitaste', 'SEPARACION_FUNCIONES');
    }
    if (niveles.some((n) => n.orden !== nivel.orden && sid(n.decididoPor) === sid(actorId))) {
      throw new ApiError(403, 'Ya decidiste otro nivel de esta requisición', 'SEPARACION_FUNCIONES');
    }
    if (!(await this.isEligible(tenantId, nivel, actorId))) {
      throw new ApiError(403, 'No eres aprobador elegible del nivel actual', 'APROBADOR_NO_ELEGIBLE', { nivel: nivel.orden });
    }
    return { doc, niveles, nivel };
  }

  /**
   * Eligible ids per PENDING level (live): frozen ids that still hold `requisiciones:approve` plus, for `rol` levels,
   * the current members of the role; `excluded` ids (creator, requester, deciders...) never count.
   * @returns {Promise<{ orden: number, nombre?: string, ids: string[] }[]>}
   */
  async _pendingPools(tenantId, pendientes, excluded) {
    const levels = [];
    for (const n of pendientes) {
      const pool = n.aprobadorTipo === APROBADOR_TIPO.ROL && n.rolId
        ? await eligibleIdsForRule(tenantId, { aprobadorTipo: APROBADOR_TIPO.ROL, rolId: n.rolId }, null)
        : [];
      const frozen = await usersWithApprove(tenantId, n.aprobadorIds || []);
      levels.push({ orden: n.orden, nombre: n.nombre, ids: [...new Set([...pool, ...frozen])].filter((u) => !excluded.has(u)) });
    }
    return levels;
  }

  /**
   * 409 APROBACION_BLOQUEARIA_NIVEL when, once `actorId` decides the current level, the remaining pending levels no
   * longer have a DISTINCT eligible approver each (the actor and everyone who already decided are excluded). Applies to
   * approve only: reject never calls it (it ends the flow, so it can never orphan a level).
   */
  async _assertApprovalKeepsFeasible(tenantId, doc, niveles, nivel, actorId) {
    const excluded = new Set([sid(doc.creadaPor), sid(doc.solicitanteId), sid(actorId)]);
    for (const n of niveles) if (n.decididoPor) excluded.add(sid(n.decididoPor));
    const remaining = niveles.filter((n) => n.estado === NIVEL_ESTADO.PENDIENTE && n.orden > nivel.orden);
    const levels = await this._pendingPools(tenantId, remaining, excluded);
    const result = findDistinctAssignment(levels.map((l) => ({ key: l.orden, ids: l.ids })));
    if (result.feasible) return;
    const byOrden = new Map(levels.map((l) => [l.orden, l]));
    const bloqueados = result.offending.map((orden) => ({ orden, nombre: byOrden.get(orden)?.nombre }));
    const names = bloqueados.map((n) => `"${n.nombre ?? n.orden}"`).join(', ');
    throw new ApiError(
      409,
      `No puedes aprobar este nivel: dejarías sin aprobador disponible a los niveles ${names} (una misma persona no puede decidir dos niveles). Pide a otro aprobador elegible que lo apruebe o solicita una reasignación de aprobadores.`,
      'APROBACION_BLOQUEARIA_NIVEL',
      { niveles: bloqueados, nivel: nivel.orden },
    );
  }

  /**
   * Approves the current level. Intermediate level: stays `En_Aprobacion` with the next level current. Last level:
   * `En_Aprobacion -> Aprobada` (+ `aprobadaAt`). One atomic write guarded by `aprobacion.nivelActual`.
   *
   * @param {string} tenantId
   * @param {string} id
   * @param {{ userId: string, name?: string }} actor
   * @param {{ version: number, observacion?: string }} data
   */
  async approve(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const { doc, niveles, nivel } = await this._loadForDecision(tenantId, id, actor.userId, data.version);
    const now = new Date();
    const observacion = data.observacion || undefined;
    const next = niveles
      .filter((n) => n.estado === NIVEL_ESTADO.PENDIENTE && n.orden > nivel.orden)
      .sort((a, b) => a.orden - b.orden)[0];
    // Authoritative anti-deadlock guard (N1): this approval must not orphan a later level. No mutation on refusal.
    if (next) await this._assertApprovalKeepsFeasible(tenantId, doc, niveles, nivel, actor.userId);

    const decided = niveles.map((n) => (n.orden === nivel.orden
      ? { ...n, estado: NIVEL_ESTADO.APROBADO, decididoPor: actor.userId, fecha: now, ...(observacion ? { observacion } : {}) }
      : n));
    const levelEvent = buildTimelineEvent({
      tipo: REQUISICION_EVENTO.NIVEL_APROBADO,
      actorId: actor.userId,
      estadoAnterior: REQUISICION_ESTADO.EN_APROBACION,
      estadoNuevo: REQUISICION_ESTADO.EN_APROBACION,
      observacion,
      datos: { nivel: nivel.orden },
      fecha: now,
    });
    const guard = { 'aprobacion.nivelActual': nivel.orden, ...versionFilter(doc.version ?? 1) };
    const ctx = { actorId: actor.userId, actorName: actor.name, nivel };

    let updated;
    if (next) {
      updated = await atomicWrite(tenantId, id, {
        expectedEstado: REQUISICION_ESTADO.EN_APROBACION,
        extraFilter: guard,
        events: [levelEvent],
        set: { 'aprobacion.niveles': decided, 'aprobacion.nivelActual': next.orden },
      });
      notifyRequisicion(tenantId, 'requisicion.level.approved', updated, ctx);
      notifyRequisicion(tenantId, 'requisicion.approval.requested', updated, { ...ctx, nivel: next, approverLevel: next });
    } else {
      updated = await transition(tenantId, id, {
        from: REQUISICION_ESTADO.EN_APROBACION,
        to: REQUISICION_ESTADO.APROBADA,
        extraFilter: guard,
        events: [
          levelEvent,
          buildTimelineEvent({
            tipo: REQUISICION_EVENTO.APROBADA,
            actorId: actor.userId,
            estadoAnterior: REQUISICION_ESTADO.EN_APROBACION,
            estadoNuevo: REQUISICION_ESTADO.APROBADA,
            fecha: now,
          }),
        ],
        set: { 'aprobacion.niveles': decided, 'aprobacion.nivelActual': null, aprobadaAt: now },
      });
      await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: actor.userId });
      notifyRequisicion(tenantId, 'requisicion.approved', updated, ctx);
    }
    logger.info('Requisicion nivel aprobado: ' + doc._id);
    return toPublicPopulated(updated);
  }

  /**
   * Rejects the current level: that level becomes `Rechazado`, the remaining pending ones `Cancelado` and the
   * requisition `Rechazada`. The observation is mandatory (400 before anything else).
   */
  async reject(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const observacion = typeof data.observacion === 'string' ? data.observacion.trim() : '';
    if (!observacion) throw new ApiError(400, 'La observación es obligatoria para rechazar', 'OBSERVACION_REQUERIDA');
    const { doc, niveles, nivel } = await this._loadForDecision(tenantId, id, actor.userId, data.version);
    const now = new Date();
    const decided = niveles.map((n) => {
      if (n.orden === nivel.orden) return { ...n, estado: NIVEL_ESTADO.RECHAZADO, decididoPor: actor.userId, fecha: now, observacion };
      if (n.estado === NIVEL_ESTADO.PENDIENTE) return { ...n, estado: NIVEL_ESTADO.CANCELADO };
      return n;
    });
    const updated = await transition(tenantId, id, {
      from: REQUISICION_ESTADO.EN_APROBACION,
      to: REQUISICION_ESTADO.RECHAZADA,
      extraFilter: { 'aprobacion.nivelActual': nivel.orden, ...versionFilter(doc.version ?? 1) },
      events: [
        buildTimelineEvent({
          tipo: REQUISICION_EVENTO.NIVEL_RECHAZADO,
          actorId: actor.userId,
          estadoAnterior: REQUISICION_ESTADO.EN_APROBACION,
          estadoNuevo: REQUISICION_ESTADO.EN_APROBACION,
          observacion,
          datos: { nivel: nivel.orden },
          fecha: now,
        }),
        buildTimelineEvent({
          tipo: REQUISICION_EVENTO.RECHAZADA,
          actorId: actor.userId,
          estadoAnterior: REQUISICION_ESTADO.EN_APROBACION,
          estadoNuevo: REQUISICION_ESTADO.RECHAZADA,
          observacion,
          fecha: now,
        }),
      ],
      set: { 'aprobacion.niveles': decided, 'aprobacion.nivelActual': null, rechazadaAt: now },
    });
    await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: actor.userId });
    notifyRequisicion(tenantId, 'requisicion.rejected', updated, { actorId: actor.userId, actorName: actor.name, nivel, reason: observacion });
    logger.info('Requisicion rechazada: ' + doc._id);
    return toPublicPopulated(updated);
  }

  /**
   * Supervisor override (permission `requisiciones:manage-all`, enforced by the route): replaces the approvers of a
   * PENDING level of an `En_Aprobacion` requisition (unblocks a level whose approvers left or cannot decide).
   * The new approvers must be live users holding `requisiciones:approve`, not the creator / requester, not users that
   * already decided another level, and the remaining pending levels must still have a distinct approver each.
   * A `rol` level becomes an explicit `usuarios` level (the role members would otherwise stay eligible).
   * The actor cannot assign himself (400 SEPARACION_FUNCIONES). The write is guarded by nivelActual + version and
   * bumps `version`, so it cannot interleave with a concurrent decision. Timeline event APROBADORES_REASIGNADOS. The new approvers of the CURRENT level are notified.
   *
   * @param {{ nivelOrden: number, aprobadorIds: string[], observacion?: string }} data
   */
  async reassign(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const doc = await Requisicion.findOne({ _id: id, tenantId });
    if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
    if (doc.estado !== REQUISICION_ESTADO.EN_APROBACION) {
      throw new ApiError(409, `La requisición está en estado ${doc.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
    const niveles = (doc.aprobacion?.niveles || []).map(plain);
    const target = niveles.find((n) => n.orden === data.nivelOrden && n.estado === NIVEL_ESTADO.PENDIENTE);
    if (!target) {
      throw new ApiError(409, 'Solo se pueden reasignar los aprobadores de un nivel pendiente', 'NIVEL_NO_PENDIENTE', { nivelOrden: data.nivelOrden });
    }
    const ids = [...new Set((data.aprobadorIds || []).map(sid))];
    const people = new Set([sid(doc.creadaPor), sid(doc.solicitanteId)]);
    const decided = new Set(niveles.map((n) => sid(n.decididoPor)).filter(Boolean));
    // A supervisor (manage-all) cannot put himself in the chain he is overriding (decision N2).
    if (ids.includes(sid(actor.userId))) {
      throw new ApiError(400, 'No puedes asignarte a ti mismo como aprobador al reasignar', 'SEPARACION_FUNCIONES', { usuarios: [sid(actor.userId)] });
    }
    const forbidden = ids.filter((u) => people.has(u) || decided.has(u));
    if (forbidden.length > 0) {
      throw new ApiError(400, 'El creador, el solicitante y quienes ya decidieron otro nivel no pueden ser aprobadores', 'SEPARACION_FUNCIONES', { usuarios: forbidden });
    }
    const valid = new Set(await usersWithApprove(tenantId, ids));
    const invalid = ids.filter((u) => !valid.has(u));
    if (invalid.length > 0) {
      throw new ApiError(400, 'Uno o más usuarios no existen en la organización o no tienen el permiso de aprobar requisiciones', 'APROBADOR_NO_ELEGIBLE', { usuarios: invalid });
    }

    // The other pending levels must still be satisfiable with distinct people.
    const others = niveles.filter((n) => n.estado === NIVEL_ESTADO.PENDIENTE && n.orden !== target.orden);
    const levels = [
      { orden: target.orden, nombre: target.nombre, ids },
      ...(await this._pendingPools(tenantId, others, new Set([...people, ...decided]))),
    ];
    assertLevelsFeasible(levels);

    const now = new Date();
    const anteriores = (target.aprobadorIds || []).map(sid);
    const newNiveles = niveles.map((n) => {
      if (n.orden !== target.orden) return n;
      const next = { ...n, aprobadorIds: ids };
      if (n.aprobadorTipo === APROBADOR_TIPO.ROL) {
        next.aprobadorTipo = APROBADOR_TIPO.USUARIOS;
        next.rolId = null;
        next.usuariosIds = ids;
      }
      return next;
    });
    const updated = await atomicWrite(tenantId, id, {
      expectedEstado: REQUISICION_ESTADO.EN_APROBACION,
      extraFilter: { 'aprobacion.nivelActual': doc.aprobacion?.nivelActual ?? null, ...versionFilter(doc.version ?? 1) },
      events: [buildTimelineEvent({
        tipo: REQUISICION_EVENTO.APROBADORES_REASIGNADOS,
        actorId: actor.userId,
        estadoAnterior: REQUISICION_ESTADO.EN_APROBACION,
        estadoNuevo: REQUISICION_ESTADO.EN_APROBACION,
        observacion: data.observacion,
        datos: { nivel: target.orden, anteriores, nuevos: ids, tipoAnterior: target.aprobadorTipo },
        fecha: now,
      })],
      set: { 'aprobacion.niveles': newNiveles },
      // Bumps the content version: an approve/reject that read before this write fails its version guard (N3).
      inc: { version: 1 },
    });
    if (target.orden === doc.aprobacion?.nivelActual) {
      const level = newNiveles.find((n) => n.orden === target.orden);
      notifyRequisicion(tenantId, 'requisicion.approval.requested', updated, {
        actorId: actor.userId, actorName: actor.name, nivel: level, approverLevel: level,
      });
    }
    logger.info('Requisicion aprobadores reasignados: ' + id);
    return toPublicPopulated(updated);
  }

  /** Marks the pending levels as cancelled (withdraw / cancel while in approval). */
  cancelPendingLevels(niveles = []) {
    return niveles.map((n) => (n.estado === NIVEL_ESTADO.PENDIENTE ? { ...plain(n), estado: NIVEL_ESTADO.CANCELADO } : plain(n)));
  }

  currentLevel(doc) {
    return currentPendingLevel(doc);
  }
}

export const requisicionApprovalService = new RequisicionApprovalService();
