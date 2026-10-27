import mongoose from 'mongoose';
import { Requisicion, buildTimelineEvent, computeMontoEstimado } from '../models/requisicion.model.js';
import '../models/area.model.js';
import '../models/tipoRequisicion.model.js';
import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';
import { buildPagination } from '../utils/pagination.util.js';
import { toPublicPopulated, toPublicPopulatedList } from '../utils/requisicionPublic.util.js';
import { roundMoney } from '../utils/money.util.js';
import { getTenantCurrency } from '../utils/tenantCurrency.util.js';
import { assertCapability } from '../config/tenantCapabilities.config.js';
import { getNextRequisicionConsecutivo } from './counter.service.js';
import { areaService } from './area.service.js';
import { tipoRequisicionService } from './tipoRequisicion.service.js';
import { requisicionApprovalService } from './requisicionApproval.service.js';
import { atomicWrite, transition } from './requisicionTransition.service.js';
import { notifyRequisicion, currentPendingLevel } from './requisicionNotify.service.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  LINEA_ESTADO,
  NIVEL_ESTADO,
  REQUISICION_ESTADO,
  REQUISICION_EVENTO,
  REQUISICION_MAX_LINEAS,
  REQUISICION_SORT_FIELDS,
  REQUISICION_TZ_OFFSET,
} from '../constants/requisicion.constants.js';

const sid = (v) => (v === null || v === undefined ? '' : String(v));
const plainObj = (o) => (o && typeof o.toObject === 'function' ? o.toObject() : { ...o });
const STOCK_MESSAGE = 'Tu organización no tiene habilitado el inventario; las líneas no pueden referenciar ítems de stock.';

const dayStart = (d) => new Date(`${d}T00:00:00.000${REQUISICION_TZ_OFFSET}`);
const dayEnd = (d) => new Date(`${d}T23:59:59.999${REQUISICION_TZ_OFFSET}`);

export class RequisicionService {
  // ------------------------------------------------------------------------------------------------ lines

  /**
   * Validates and builds the stored lines from the payload.
   *  - stock items need `usesInventoryBasic` (403 CAPABILITY_DISABLED) and must belong to the tenant;
   *  - the same item twice -> 409 LINEA_DUPLICADA;
   *  - a stock line fills description/unit/price from the item and keeps a SNAPSHOT that does not change later;
   *  - when updating, lines are matched by `lineaId` (the existing line wins its snapshot / fulfilment fields).
   */
  async buildLineas(tenantId, payload, { capabilities, moneda, existing = [] } = {}) {
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new ApiError(400, 'La requisición debe tener al menos una línea', 'SIN_LINEAS');
    }
    if (payload.length > REQUISICION_MAX_LINEAS) {
      throw new ApiError(400, `La requisición admite máximo ${REQUISICION_MAX_LINEAS} líneas`, 'DEMASIADAS_LINEAS');
    }
    const byId = new Map(existing.map((l) => [sid(l.lineaId), plainObj(l)]));
    const itemIds = payload.map((l) => l.inventarioItemId).filter(Boolean).map(sid);
    if (itemIds.length > 0) assertCapability(capabilities, 'usesInventoryBasic', STOCK_MESSAGE);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new ApiError(409, 'Un ítem de stock solo puede aparecer en una línea', 'LINEA_DUPLICADA');
    }
    const items = itemIds.length > 0
      ? await InventarioRepuesto.find(applyTenantFilter({ _id: { $in: itemIds } }, tenantId)).lean()
      : [];
    const itemById = new Map(items.map((i) => [sid(i._id), i]));

    const seen = new Set();
    return payload.map((l) => {
      const prev = l.lineaId ? byId.get(sid(l.lineaId)) : null;
      if (l.lineaId && !prev) throw new ApiError(400, 'La línea indicada no pertenece a la requisición', 'LINEA_NO_ENCONTRADA', { lineaId: l.lineaId });
      if (l.lineaId) {
        if (seen.has(sid(l.lineaId))) throw new ApiError(400, 'Línea repetida en el payload', 'LINEA_NO_ENCONTRADA', { lineaId: l.lineaId });
        seen.add(sid(l.lineaId));
      }
      const itemId = l.inventarioItemId ? sid(l.inventarioItemId) : null;
      const item = itemId ? itemById.get(itemId) : null;
      if (itemId && !item) throw new ApiError(400, 'El ítem de stock no existe en la organización', 'ITEM_INVALIDO', { inventarioItemId: itemId });

      // Same item as before: keep the snapshot taken when the line was first saved.
      const sameItem = prev && sid(prev.inventarioItemId) === itemId;
      const snapshot = item
        ? (sameItem && prev.snapshot ? prev.snapshot : { nombre: item.nombre, referencia: item.referencia, unidad: item.unidad, precio: item.precio })
        : undefined;
      const precio = l.precioEstimado !== undefined
        ? l.precioEstimado
        : (prev ? prev.precioEstimado : (item?.precio ?? 0));
      const out = {
        ...(prev || {}),
        descripcion: l.descripcion || prev?.descripcion || item?.nombre,
        especificaciones: l.especificaciones !== undefined ? l.especificaciones : prev?.especificaciones,
        unidad: l.unidad || prev?.unidad || item?.unidad || 'und',
        cantidadSolicitada: l.cantidadSolicitada,
        precioEstimado: roundMoney(precio),
        moneda,
        inventarioItemId: itemId,
        estadoLinea: prev?.estadoLinea || LINEA_ESTADO.PENDIENTE,
      };
      if (snapshot) out.snapshot = snapshot; else delete out.snapshot;
      if (!prev) out.lineaId = new mongoose.Types.ObjectId();
      // Untouched fulfilment fields are zero in Borrador; a changed requested quantity restarts the pending one.
      out.cantidadPendiente = out.cantidadSolicitada - (out.cantidadSurtida || 0);
      return out;
    });
  }

  async _assertSolicitante(tenantId, userId) {
    const user = await User.findOne({ _id: userId, tenantId }).select('_id').lean();
    if (!user) throw new ApiError(400, 'El solicitante no pertenece a la organización', 'SOLICITANTE_INVALIDO', { solicitanteId: userId });
  }

  // ------------------------------------------------------------------------------------------------ CRUD

  /**
   * Creates a requisition in Borrador. The consecutivo is allocated AFTER every validation (gaps are accepted), the
   * currency is forced to the tenant's, `montoEstimado` is derived and `solicitanteId` defaults to the creator.
   */
  async create(tenantId, userId, data, capabilities) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = data;
    await tipoRequisicionService.assertTipoActivo(tenantId, clean.tipoRequisicionId);
    await areaService.assertAreaActiva(tenantId, clean.areaId);
    const solicitanteId = clean.solicitanteId || userId;
    if (sid(solicitanteId) !== sid(userId)) await this._assertSolicitante(tenantId, solicitanteId);
    const moneda = await getTenantCurrency(tenantId);
    const lineas = await this.buildLineas(tenantId, clean.lineas, { capabilities, moneda });

    const { consecutivo } = await getNextRequisicionConsecutivo(tenantId);
    const now = new Date();
    try {
      const created = await Requisicion.create({
        tenantId,
        consecutivo,
        titulo: clean.titulo,
        tipoRequisicionId: clean.tipoRequisicionId,
        areaId: clean.areaId,
        prioridad: clean.prioridad,
        fechaRequerida: clean.fechaRequerida ?? null,
        justificacion: clean.justificacion,
        creadaPor: userId,
        solicitanteId,
        lineas,
        moneda,
        estado: REQUISICION_ESTADO.BORRADOR,
        timeline: [buildTimelineEvent({
          tipo: REQUISICION_EVENTO.CREADA,
          actorId: userId,
          estadoNuevo: REQUISICION_ESTADO.BORRADOR,
          fecha: now,
        })],
      });
      logger.info('Requisicion creada: ' + created._id);
      return toPublicPopulated(created);
    } catch (err) {
      if (err && err.code === 11000) throw new ApiError(409, 'Consecutivo duplicado; intenta de nuevo', 'CONSECUTIVO_DUPLICADO');
      throw err;
    }
  }

  /** Mongo `$expr` matching requisitions whose CURRENT pending level `user` can decide (frozen ids or role). */
  async _porAprobarFilter(tenantId, userId) {
    const userOid = new mongoose.Types.ObjectId(String(userId));
    const user = await User.findOne({ _id: userId, tenantId }).select('roleId').lean();
    let roleOid = null;
    if (user?.roleId) {
      const role = await Role.findOne({ _id: user.roleId, tenantId }).lean();
      if (role && (role.permissions || []).includes(PERMISSIONS.REQUISICIONES_APPROVE)) roleOid = new mongoose.Types.ObjectId(String(user.roleId));
    }
    const eligible = [{ $in: [userOid, { $ifNull: ['$$n.aprobadorIds', []] }] }];
    if (roleOid) eligible.push({ $eq: ['$$n.rolId', roleOid] });
    // Returned as AND-ed clauses so an explicit `creadaPor` / `estado` filter is combined, never overwritten.
    return [
      { estado: REQUISICION_ESTADO.EN_APROBACION },
      { creadaPor: { $ne: userOid } },
      { solicitanteId: { $ne: userOid } },
      // Separation of duties: not already a decider of the requisition.
      { 'aprobacion.niveles.decididoPor': { $ne: userOid } },
      {
        $expr: {
          $gt: [{
            $size: {
              $filter: {
                input: { $ifNull: ['$aprobacion.niveles', []] },
                as: 'n',
                cond: {
                  $and: [
                    { $eq: ['$$n.orden', '$aprobacion.nivelActual'] },
                    { $eq: ['$$n.estado', NIVEL_ESTADO.PENDIENTE] },
                    { $or: eligible },
                  ],
                },
              },
            },
          }, 0],
        },
      },
    ];
  }

  /**
   * Server-side paginated list (`sortBy` whitelisted, default newest first). `vista=mias` (creator or requester) and `vista=por-aprobar` (current
   * level of the caller) narrow it down; `search` is an escaped literal over consecutivo/titulo.
   */
  async list(tenantId, userId, filters = {}, pagination = {}) {
    requireTenant(tenantId);
    const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = pagination;
    const sortField = REQUISICION_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt';
    const dir = order === 'asc' ? 1 : -1;
    const query = applyTenantFilter({}, tenantId);
    for (const key of ['estado', 'areaId', 'tipoRequisicionId', 'creadaPor']) {
      if (filters[key]) query[key] = filters[key];
    }
    if (filters.fechaDesde || filters.fechaHasta) {
      query.createdAt = {};
      if (filters.fechaDesde) query.createdAt.$gte = dayStart(filters.fechaDesde);
      if (filters.fechaHasta) query.createdAt.$lte = dayEnd(filters.fechaHasta);
    }
    const and = [];
    if (filters.search) {
      const rx = new RegExp(escapeRegex(filters.search), 'i');
      and.push({ $or: [{ consecutivo: rx }, { titulo: rx }] });
    }
    if (filters.vista === 'mias') {
      and.push({ $or: [{ creadaPor: userId }, { solicitanteId: userId }] });
    } else if (filters.vista === 'por-aprobar') {
      and.push(...await this._porAprobarFilter(tenantId, userId));
      // An explicit estado filter cannot widen the inbox beyond En_Aprobacion.
      if (filters.estado && filters.estado !== REQUISICION_ESTADO.EN_APROBACION) query.estado = '__none__';
    }
    if (and.length > 0) query.$and = and;

    const [rows, total] = await Promise.all([
      Requisicion.find(query)
        .select('-timeline')
        .sort({ [sortField]: dir, _id: dir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Requisicion.countDocuments({ ...query, isDeleted: { $ne: true } }),
    ]);
    return { data: await toPublicPopulatedList(rows), pagination: buildPagination(page, limit, total) };
  }

  /** Detail by id; another tenant's (or deleted) requisition is a 404, never a 403. */
  async getById(tenantId, id) {
    requireTenant(tenantId);
    const doc = await Requisicion.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
    return toPublicPopulated(doc);
  }

  async _findOr404(tenantId, id) {
    const doc = await Requisicion.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
    return doc;
  }

  _assertEstado(doc, expected) {
    if (doc.estado !== expected) {
      throw new ApiError(409, `La requisición está en estado ${doc.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
  }

  /** Creator or requester of the requisition; `requisiciones:manage-all` (actor.canManageAll) overrides. */
  _assertOwner(doc, actor) {
    if (actor.canManageAll) return;
    if (sid(doc.creadaPor) !== sid(actor.userId) && sid(doc.solicitanteId) !== sid(actor.userId)) {
      throw new ApiError(403, 'Solo el creador o el solicitante puede realizar esta operación', 'SOLO_CREADOR');
    }
  }

  /**
   * Edits the content. Only in Borrador (409 ESTADO_NO_EDITABLE); the type never changes (400 TIPO_INMUTABLE).
   * Only the creator or the requester may edit (403 SOLO_CREADOR); only the creator may change `solicitanteId`.
   * `options.canManageAll` (permission requisiciones:manage-all) overrides both. Bumps the content `version`.
   */
  async update(tenantId, userId, id, data, capabilities, options = {}) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = data;
    if (clean.tipoRequisicionId !== undefined) {
      throw new ApiError(400, 'El tipo de requisición no puede cambiar', 'TIPO_INMUTABLE');
    }
    const doc = await this._findOr404(tenantId, id);
    if (doc.estado !== REQUISICION_ESTADO.BORRADOR) {
      throw new ApiError(409, 'Solo se puede editar una requisición en Borrador; retírala primero', 'ESTADO_NO_EDITABLE', { estadoActual: doc.estado });
    }
    const canManageAll = Boolean(options.canManageAll);
    this._assertOwner(doc, { userId, canManageAll });
    const set = {};
    for (const key of ['titulo', 'prioridad', 'fechaRequerida', 'justificacion']) {
      if (clean[key] !== undefined) set[key] = clean[key];
    }
    if (clean.areaId !== undefined && sid(clean.areaId) !== sid(doc.areaId)) {
      await areaService.assertAreaActiva(tenantId, clean.areaId);
      set.areaId = clean.areaId;
    }
    if (clean.solicitanteId !== undefined && sid(clean.solicitanteId) !== sid(doc.solicitanteId)) {
      if (!canManageAll && sid(doc.creadaPor) !== sid(userId)) {
        throw new ApiError(403, 'Solo el creador puede cambiar el solicitante', 'SOLO_CREADOR');
      }
      await this._assertSolicitante(tenantId, clean.solicitanteId);
      set.solicitanteId = clean.solicitanteId;
    }
    if (clean.lineas !== undefined) {
      const moneda = await getTenantCurrency(tenantId);
      const lineas = await this.buildLineas(tenantId, clean.lineas, { capabilities, moneda, existing: doc.lineas || [] });
      set.lineas = lineas;
      // findOneAndUpdate bypasses the pre('validate') derivation: the amount is set explicitly here.
      set.montoEstimado = computeMontoEstimado(lineas);
    }
    const updated = await atomicWrite(tenantId, id, {
      expectedEstado: REQUISICION_ESTADO.BORRADOR,
      events: [buildTimelineEvent({
        tipo: REQUISICION_EVENTO.EDITADA,
        actorId: userId,
        estadoAnterior: REQUISICION_ESTADO.BORRADOR,
        estadoNuevo: REQUISICION_ESTADO.BORRADOR,
        datos: { campos: Object.keys(clean) },
      })],
      set,
      inc: { version: 1 },
    }).catch((err) => {
      // The state moved between our read and the write: for an edit that is "no longer editable".
      if (err.code === 'TRANSICION_INVALIDA') {
        throw new ApiError(409, 'Solo se puede editar una requisición en Borrador; retírala primero', 'ESTADO_NO_EDITABLE', err.details);
      }
      throw err;
    });
    logger.info('Requisicion actualizada: ' + id);
    return toPublicPopulated(updated);
  }

  /**
   * Soft delete, only in Borrador, by the creator / requester (or `actor.canManageAll`). The timeline keeps an
   * ELIMINADA entry (audit trail of the deleted document).
   */
  async delete(tenantId, id, actor = {}) {
    requireTenant(tenantId);
    const doc = await this._findOr404(tenantId, id);
    if (doc.estado !== REQUISICION_ESTADO.BORRADOR) {
      throw new ApiError(409, 'Solo se puede eliminar una requisición en Borrador', 'ESTADO_NO_EDITABLE', { estadoActual: doc.estado });
    }
    this._assertOwner(doc, actor);
    await atomicWrite(tenantId, id, {
      expectedEstado: REQUISICION_ESTADO.BORRADOR,
      events: [buildTimelineEvent({
        tipo: REQUISICION_EVENTO.ELIMINADA,
        actorId: actor.userId,
        estadoAnterior: REQUISICION_ESTADO.BORRADOR,
        estadoNuevo: REQUISICION_ESTADO.BORRADOR,
      })],
      set: { isDeleted: true, deletedAt: new Date() },
    }).catch((err) => {
      if (err.code === 'TRANSICION_INVALIDA') {
        throw new ApiError(409, 'Solo se puede eliminar una requisición en Borrador', 'ESTADO_NO_EDITABLE', err.details);
      }
      throw err;
    });
    logger.info('Requisicion eliminada (soft): ' + id);
  }

  // ------------------------------------------------------------------------------------------------ transitions

  /**
   * Submits for approval: Borrador -> Enviada -> En_Aprobacion in ONE write (events ENVIADA + APROBACION_SOLICITADA).
   * Needs >= 1 active line and a justification; levels are resolved (422 before any change) and frozen.
   */
  async enviar(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const doc = await this._findOr404(tenantId, id);
    this._assertEstado(doc, REQUISICION_ESTADO.BORRADOR);
    this._assertOwner(doc, actor);
    const activas = (doc.lineas || []).filter((l) => l.estadoLinea !== LINEA_ESTADO.CANCELADA);
    if (activas.length === 0) throw new ApiError(400, 'La requisición debe tener al menos una línea', 'SIN_LINEAS');
    const justificacion = (data.justificacion || doc.justificacion || '').trim();
    if (!justificacion) throw new ApiError(400, 'La justificación es obligatoria para enviar', 'JUSTIFICACION_REQUERIDA');

    const niveles = await requisicionApprovalService.resolveLevels(tenantId, doc);
    const now = new Date();
    const first = niveles[0];
    const extraFilter = doc.updatedAt ? { updatedAt: doc.updatedAt } : {};
    const updated = await transition(tenantId, id, {
      from: REQUISICION_ESTADO.BORRADOR,
      via: [REQUISICION_ESTADO.ENVIADA],
      to: REQUISICION_ESTADO.EN_APROBACION,
      extraFilter,
      events: [
        buildTimelineEvent({
          tipo: REQUISICION_EVENTO.ENVIADA,
          actorId: actor.userId,
          estadoAnterior: REQUISICION_ESTADO.BORRADOR,
          estadoNuevo: REQUISICION_ESTADO.ENVIADA,
          fecha: now,
        }),
        buildTimelineEvent({
          tipo: REQUISICION_EVENTO.APROBACION_SOLICITADA,
          actorId: actor.userId,
          estadoAnterior: REQUISICION_ESTADO.ENVIADA,
          estadoNuevo: REQUISICION_ESTADO.EN_APROBACION,
          datos: { niveles: niveles.length, nivel: first.orden },
          fecha: now,
        }),
      ],
      set: {
        enviadaAt: now,
        justificacion,
        'aprobacion.niveles': niveles,
        'aprobacion.nivelActual': first.orden,
      },
      inc: { version: 1 },
    });
    const ctx = { actorId: actor.userId, actorName: actor.name };
    notifyRequisicion(tenantId, 'requisicion.submitted', updated, ctx);
    notifyRequisicion(tenantId, 'requisicion.approval.requested', updated, { ...ctx, nivel: first, approverLevel: first });
    logger.info('Requisicion enviada: ' + id);
    return toPublicPopulated(updated);
  }

  /** En_Aprobacion -> Borrador (RETIRADA). Pending levels are cancelled. Observation required. */
  async retirar(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const observacion = (data.observacion || '').trim();
    if (!observacion) throw new ApiError(400, 'La observación es obligatoria para retirar', 'OBSERVACION_REQUERIDA');
    const doc = await this._findOr404(tenantId, id);
    this._assertEstado(doc, REQUISICION_ESTADO.EN_APROBACION);
    this._assertOwner(doc, actor);
    const pendiente = currentPendingLevel(doc);
    const niveles = requisicionApprovalService.cancelPendingLevels(doc.aprobacion?.niveles || []);
    const updated = await transition(tenantId, id, {
      from: REQUISICION_ESTADO.EN_APROBACION,
      to: REQUISICION_ESTADO.BORRADOR,
      extraFilter: { 'aprobacion.nivelActual': doc.aprobacion?.nivelActual ?? null },
      events: [buildTimelineEvent({
        tipo: REQUISICION_EVENTO.RETIRADA,
        actorId: actor.userId,
        estadoAnterior: REQUISICION_ESTADO.EN_APROBACION,
        estadoNuevo: REQUISICION_ESTADO.BORRADOR,
        observacion,
      })],
      set: { 'aprobacion.niveles': niveles, 'aprobacion.nivelActual': null },
      inc: { version: 1 },
    });
    notifyRequisicion(tenantId, 'requisicion.withdrawn', updated, {
      actorId: actor.userId, actorName: actor.name, reason: observacion, approverLevel: pendiente,
    });
    return toPublicPopulated(updated);
  }

  /** Rechazada -> Borrador (REABIERTA). */
  async reabrir(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const doc = await this._findOr404(tenantId, id);
    this._assertEstado(doc, REQUISICION_ESTADO.RECHAZADA);
    this._assertOwner(doc, actor);
    const updated = await transition(tenantId, id, {
      from: REQUISICION_ESTADO.RECHAZADA,
      to: REQUISICION_ESTADO.BORRADOR,
      events: [buildTimelineEvent({
        tipo: REQUISICION_EVENTO.REABIERTA,
        actorId: actor.userId,
        estadoAnterior: REQUISICION_ESTADO.RECHAZADA,
        estadoNuevo: REQUISICION_ESTADO.BORRADOR,
        observacion: data.observacion,
      })],
      set: {},
      inc: { version: 1 },
    });
    return toPublicPopulated(updated);
  }

  /** PATCH /:id/estado {estado:'Borrador'}: retire (from En_Aprobacion) or reopen (from Rechazada). */
  async cambiarEstado(tenantId, id, actor, data) {
    requireTenant(tenantId);
    const doc = await this._findOr404(tenantId, id);
    if (data.estado !== REQUISICION_ESTADO.BORRADOR) {
      throw new ApiError(409, 'Solo se admite volver a Borrador', 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
    if (doc.estado === REQUISICION_ESTADO.EN_APROBACION) return this.retirar(tenantId, id, actor, data);
    if (doc.estado === REQUISICION_ESTADO.RECHAZADA) return this.reabrir(tenantId, id, actor, data);
    throw new ApiError(409, `La requisición está en estado ${doc.estado} y no puede volver a Borrador`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
  }

  /**
   * Cancels from ANY non-terminal state (including Aprobada). Motivo required. Pending levels become Cancelado.
   * Retries once when the state moved between the read and the conditional write.
   */
  async cancelar(tenantId, id, actor, data = {}) {
    requireTenant(tenantId);
    const motivo = (data.motivo || '').trim();
    if (!motivo) throw new ApiError(400, 'El motivo es obligatorio para cancelar', 'MOTIVO_REQUERIDO');
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const doc = await this._findOr404(tenantId, id);
      const from = doc.estado;
      const enAprobacion = from === REQUISICION_ESTADO.EN_APROBACION;
      const pendiente = enAprobacion ? currentPendingLevel(doc) : null;
      const now = new Date();
      const set = { canceladaAt: now, canceladaPor: actor.userId, canceladaMotivo: motivo };
      if (enAprobacion) {
        set['aprobacion.niveles'] = requisicionApprovalService.cancelPendingLevels(doc.aprobacion?.niveles || []);
        set['aprobacion.nivelActual'] = null;
      }
      try {
        const updated = await transition(tenantId, id, {
          from,
          to: REQUISICION_ESTADO.CANCELADA,
          extraFilter: enAprobacion ? { 'aprobacion.nivelActual': doc.aprobacion?.nivelActual ?? null } : {},
          events: [buildTimelineEvent({
            tipo: REQUISICION_EVENTO.CANCELADA,
            actorId: actor.userId,
            estadoAnterior: from,
            estadoNuevo: REQUISICION_ESTADO.CANCELADA,
            observacion: motivo,
            fecha: now,
          })],
          set,
        });
        notifyRequisicion(tenantId, 'requisicion.cancelled', updated, {
          actorId: actor.userId, actorName: actor.name, reason: motivo, approverLevel: pendiente,
        });
        return toPublicPopulated(updated);
      } catch (err) {
        // Terminal states (Cancelada) are final: a table violation is not retried.
        if (err.code === 'CONFLICTO_CONCURRENTE') { lastErr = err; continue; }
        if (err.code === 'TRANSICION_INVALIDA' && err.details?.estadoEsperado) { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  }
}

export const requisicionService = new RequisicionService();
