import mongoose from 'mongoose';
import { Requisicion, buildTimelineEvent, computeMontoEstimado } from '../models/requisicion.model.js';
import '../models/area.model.js';
import '../models/tipoRequisicion.model.js';
import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { Repuestos } from '../models/repuestos.model.js';
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
import { syncRequisicionSolicitudesSafe, healStaleLinks } from './requisicionSolicitudSync.service.js';
import { lineGuard } from './requisicionRecepcion.service.js';
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
  async buildLineas(tenantId, payload, { capabilities, moneda, existing = [], allowOrigen = false } = {}) {
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new ApiError(400, 'La requisición debe tener al menos una línea', 'SIN_LINEAS');
    }
    if (payload.length > REQUISICION_MAX_LINEAS) {
      throw new ApiError(400, `La requisición admite máximo ${REQUISICION_MAX_LINEAS} líneas`, 'DEMASIADAS_LINEAS');
    }
    const byId = new Map(existing.map((l) => [sid(l.lineaId), plainObj(l)]));
    const itemIds = payload.map((l) => l.inventarioItemId).filter(Boolean).map(sid);
    if (itemIds.length > 0) assertCapability(capabilities, 'usesInventoryBasic', STOCK_MESSAGE);
    // A stock item appears once among MANUAL lines; lines that come from spare-part requests (they carry the origin)
    // may share it: each keeps its inventarioItemId so the stock movement and the marker apply per line.
    const fromSolicitud = (l) => Boolean((allowOrigen && l.origenSolicitudRepuestoId)
      || (l.lineaId && byId.get(sid(l.lineaId))?.origenSolicitudRepuestoId));
    const manualItems = payload.filter((l) => l.inventarioItemId && !fromSolicitud(l)).map((l) => sid(l.inventarioItemId));
    const originItems = payload.filter((l) => l.inventarioItemId && fromSolicitud(l)).map((l) => sid(l.inventarioItemId));
    if (new Set(manualItems).size !== manualItems.length || manualItems.some((i) => originItems.includes(i))) {
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
      // INTERNAL path only (conversion from spare-part requests): the public DTO never lets a client set the origin.
      if (allowOrigen && l.origenSolicitudRepuestoId) {
        out.origenSolicitudRepuestoId = l.origenSolicitudRepuestoId;
        if (l.responsableId) out.responsableId = l.responsableId;
      }
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
  async create(tenantId, userId, data, capabilities, options = {}) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = data;
    await tipoRequisicionService.assertTipoActivo(tenantId, clean.tipoRequisicionId);
    await areaService.assertAreaActiva(tenantId, clean.areaId);
    const solicitanteId = clean.solicitanteId || userId;
    if (sid(solicitanteId) !== sid(userId)) await this._assertSolicitante(tenantId, solicitanteId);
    const moneda = await getTenantCurrency(tenantId);
    const lineas = await this.buildLineas(tenantId, clean.lineas, { capabilities, moneda, allowOrigen: Boolean(options.allowOrigen) });

    const { consecutivo } = await getNextRequisicionConsecutivo(tenantId);
    const now = new Date();
    try {
      const created = await Requisicion.create({
        ...(options.id ? { _id: options.id } : {}),
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
   * `vista=por-confirmar`: requisitions with a reception item still unconfirmed that the user must confirm: the
   * responsible of the line's origin solicitud, else the requisition requester (free lines). `manage-all` sees every
   * unconfirmed item; anybody else never sees the receptions he registered himself (separation of duties).
   */
  async _porConfirmarFilter(tenantId, userId, manageAll) {
    const me = new mongoose.Types.ObjectId(String(userId));
    const unconfirmed = { $eq: [{ $type: '$$i.confirmacion' }, 'missing'] };
    let itemCond = unconfirmed;
    let recCond = { $gt: [{ $size: { $filter: { input: { $ifNull: ['$$r.items', []] }, as: 'i', cond: itemCond } } }, 0] };
    if (!manageAll) {
      const mine = await Repuestos.find({ tenantId, ResponsableSolicitud: userId, 'requisicion.requisicionId': { $exists: true } }).select('_id').lean();
      const mineIds = mine.map((s) => new mongoose.Types.ObjectId(String(s._id)));
      const responsible = {
        $gt: [{
          $size: {
            $filter: {
              input: { $ifNull: ['$lineas', []] },
              as: 'l',
              cond: {
                $and: [
                  { $eq: ['$$l.lineaId', '$$i.lineaId'] },
                  { $or: [
                    { $and: [{ $eq: [{ $ifNull: ['$$l.origenSolicitudRepuestoId', null] }, null] }, { $eq: ['$solicitanteId', me] }] },
                    { $in: ['$$l.origenSolicitudRepuestoId', mineIds] },
                  ] },
                ],
              },
            },
          },
        }, 0],
      };
      itemCond = { $and: [unconfirmed, responsible] };
      recCond = {
        $and: [
          { $ne: ['$$r.recibidaPor', me] },
          { $gt: [{ $size: { $filter: { input: { $ifNull: ['$$r.items', []] }, as: 'i', cond: itemCond } } }, 0] },
        ],
      };
    }
    return { $expr: { $gt: [{ $size: { $filter: { input: { $ifNull: ['$recepciones', []] }, as: 'r', cond: recCond } } }, 0] } };
  }

  /**
   * Server-side paginated list (`sortBy` whitelisted, default newest first). `vista=mias` (creator or requester) and `vista=por-aprobar` (current
   * level of the caller) narrow it down; `search` is an escaped literal over consecutivo/titulo.
   */
  async list(tenantId, userId, filters = {}, pagination = {}, access = {}) {
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
    } else if (filters.vista === 'por-recibir') {
      // Approved / in reception with at least one line still to receive; only for who can receive.
      if (!access.canReceive && !access.canManageAll) query.estado = '__none__';
      else {
        and.push({ estado: { $in: [REQUISICION_ESTADO.APROBADA, REQUISICION_ESTADO.EN_RECEPCION] } });
        and.push({ lineas: { $elemMatch: { estadoLinea: { $in: [LINEA_ESTADO.PENDIENTE, LINEA_ESTADO.RECIBIDA_PARCIAL, LINEA_ESTADO.EN_DISPUTA] } } } });
      }
    } else if (filters.vista === 'por-confirmar') {
      and.push({ estado: REQUISICION_ESTADO.EN_RECEPCION });
      and.push(await this._porConfirmarFilter(tenantId, userId, Boolean(access.canManageAll)));
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
    // Lines removed from the draft release the spare-part requests they came from.
    if (clean.lineas !== undefined && (doc.lineas || []).some((l) => l.origenSolicitudRepuestoId)) {
      await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: userId, checkOrphans: true });
    }
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
    const removed = await atomicWrite(tenantId, id, {
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
    // A deleted draft releases every spare-part request it held.
    if ((doc.lineas || []).some((l) => l.origenSolicitudRepuestoId)) {
      await syncRequisicionSolicitudesSafe(tenantId, removed, { actorId: actor.userId, checkOrphans: true });
    }
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
    // A line whose solicitud is held by ANOTHER requisition cannot be sent (the buy would be duplicated).
    const { removed: notSendable } = await this._revalidateOrigins(tenantId, doc);
    const held = notSendable.filter((r) => r.requisicionId);
    if (held.length > 0) {
      throw new ApiError(409, 'Una o más solicitudes de la requisición ya pertenecen a otra requisición', 'SOLICITUD_YA_VINCULADA', { ids: held.map((r) => r.repuestoId), lineas: held });
    }
    // 3.2: an origin line whose solicitud is gone or no longer Solicitado (already installed / in process) cannot be sent either
    // (consistent with reabrir, which drops such lines): the goods would be bought and moved twice.
    const gone = notSendable.filter((r) => !r.requisicionId);
    if (gone.length > 0) {
      throw new ApiError(409, 'Una o más solicitudes de la requisición ya no están disponibles para requisición (ya no existen o no están en estado Solicitado). Retira esas líneas para enviar.', 'SOLICITUD_NO_ELEGIBLE', { ids: gone.map((r) => r.repuestoId), lineas: gone });
    }

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
    await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: actor.userId });
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
    await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: actor.userId });
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
    // The rejection released the requests; while it was rejected another requisition may have taken some of them.
    const { removed } = await this._revalidateOrigins(tenantId, doc);
    const removedIds = new Set(removed.map((r) => r.lineaId));
    const kept = (doc.lineas || []).filter((l) => !removedIds.has(sid(l.lineaId))).map(plainObj);
    if (kept.filter((l) => l.estadoLinea !== LINEA_ESTADO.CANCELADA).length === 0) {
      throw new ApiError(409, 'Ninguna línea de la requisición sigue vigente: sus solicitudes ya pertenecen a otra requisición o no están disponibles. Puedes cancelarla.', 'SIN_LINEAS_VIGENTES', { lineas: removed });
    }
    const note = removed.length
      ? `Líneas retiradas al reabrir (solicitud no disponible): ${removed.map((r) => r.descripcion).join('; ')}`
      : '';
    const observacion = [data.observacion, note].filter(Boolean).join(' | ').slice(0, 2000) || undefined;
    const updated = await transition(tenantId, id, {
      from: REQUISICION_ESTADO.RECHAZADA,
      to: REQUISICION_ESTADO.BORRADOR,
      extraFilter: removed.length && doc.updatedAt ? { updatedAt: doc.updatedAt } : {},
      events: [buildTimelineEvent({
        tipo: REQUISICION_EVENTO.REABIERTA,
        actorId: actor.userId,
        estadoAnterior: REQUISICION_ESTADO.RECHAZADA,
        estadoNuevo: REQUISICION_ESTADO.BORRADOR,
        observacion,
        ...(removed.length ? { datos: { lineasRetiradas: removed } } : {}),
      })],
      set: removed.length ? { lineas: kept, montoEstimado: computeMontoEstimado(kept) } : {},
      inc: { version: 1 },
    });
    // Reopening re-claims the requests that are still free.
    await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: actor.userId });
    const pub = await toPublicPopulated(updated);
    return removed.length ? { ...pub, advertencias: removed } : pub;
  }

  /**
   * Origin lines whose solicitud can no longer be part of THIS requisition: gone, linked to another (alive) requisition
   * or not in Solicitado. Stale links are released first (lazy self-heal).
   * @returns {Promise<{ removed: { lineaId: string, repuestoId: string, descripcion: string, motivo: string, requisicionId?: string }[] }>}
   */
  async _revalidateOrigins(tenantId, doc) {
    const origin = (doc.lineas || []).filter((l) => l.origenSolicitudRepuestoId);
    if (origin.length === 0) return { removed: [] };
    const sols = await Repuestos.find({ tenantId, _id: { $in: origin.map((l) => sid(l.origenSolicitudRepuestoId)) } }).lean();
    await healStaleLinks(tenantId, sols);
    const byId = new Map(sols.map((s) => [sid(s._id), s]));
    const removed = [];
    for (const l of origin) {
      const s = byId.get(sid(l.origenSolicitudRepuestoId));
      const heldBy = s?.requisicion?.requisicionId ? sid(s.requisicion.requisicionId) : '';
      let motivo = null;
      if (!s) motivo = 'la solicitud ya no existe';
      else if (heldBy && heldBy !== sid(doc._id)) motivo = `la solicitud ya pertenece a la requisición ${s.requisicion.consecutivo || heldBy}`;
      else if (!heldBy && (s.EstadoSolicitud || 'Solicitado') !== 'Solicitado') motivo = 'la solicitud ya no está en estado Solicitado';
      if (motivo) {
        removed.push({
          lineaId: sid(l.lineaId), repuestoId: sid(l.origenSolicitudRepuestoId), descripcion: l.descripcion, motivo,
          ...(heldBy && heldBy !== sid(doc._id) ? { requisicionId: heldBy } : {}),
        });
      }
    }
    return { removed };
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
      // Goods already confirmed are never lost: those lines are closed short (Confirmada) in the same write; lines with
      // nothing confirmed are released by the sync as before.
      const toClose = (doc.lineas || []).filter((l) => Number(l.cantidadConfirmada) > 0
        && ![LINEA_ESTADO.CONFIRMADA, LINEA_ESTADO.CANCELADA].includes(l.estadoLinea || LINEA_ESTADO.PENDIENTE)).map(plainObj);
      // 3.4(a): a line closed short is priced by what was confirmed (the rest will never be bought); lines released with
      // nothing confirmed keep their estimated price. 3.4(c): units received but never confirmed are NOT lost silently.
      const closedIds = new Set(toClose.map((l) => sid(l.lineaId)));
      set.montoEstimado = computeMontoEstimado((doc.lineas || []).map((l) => {
        const o = plainObj(l);
        return closedIds.has(sid(o.lineaId)) ? { ...o, cantidadSolicitada: Number(o.cantidadConfirmada) } : o;
      }));
      const recibidasSinConfirmar = [];
      for (const l of doc.lineas || []) {
        const cantidad = (doc.recepciones || []).reduce((acc, rec) => acc + (rec.items || [])
          .filter((i) => sid(i.lineaId) === sid(l.lineaId) && !i.confirmacion)
          .reduce((a, i) => a + (Number(i.cantidadRecibida) || 0), 0), 0);
        if (cantidad > 0) recibidasSinConfirmar.push({ lineaId: sid(l.lineaId), descripcion: l.descripcion, cantidad });
      }
      const arrayFilters = [];
      const guards = [];
      const closeEvents = toClose.map((l, i) => {
        set[`lineas.$[c${i}].estadoLinea`] = LINEA_ESTADO.CONFIRMADA;
        set[`lineas.$[c${i}].cierre`] = { motivo, por: actor.userId, fecha: now };
        arrayFilters.push({ [`c${i}.lineaId`]: new mongoose.Types.ObjectId(sid(l.lineaId)) });
        guards.push(lineGuard(l));
        return buildTimelineEvent({
          tipo: REQUISICION_EVENTO.LINEA_CERRADA,
          actorId: actor.userId,
          estadoAnterior: from,
          estadoNuevo: from,
          observacion: motivo,
          datos: { lineaId: sid(l.lineaId), descripcion: l.descripcion, cantidadSolicitada: l.cantidadSolicitada, cantidadConfirmada: Number(l.cantidadConfirmada), porCancelacion: true },
          fecha: now,
        });
      });
      try {
        const updated = await transition(tenantId, id, {
          from,
          to: REQUISICION_ESTADO.CANCELADA,
          extraFilter: {
            ...(enAprobacion ? { 'aprobacion.nivelActual': doc.aprobacion?.nivelActual ?? null } : {}),
            ...(guards.length ? { $and: guards } : {}),
          },
          arrayFilters,
          events: [...closeEvents, buildTimelineEvent({
            tipo: REQUISICION_EVENTO.CANCELADA,
            actorId: actor.userId,
            estadoAnterior: from,
            estadoNuevo: REQUISICION_ESTADO.CANCELADA,
            observacion: motivo,
            ...(recibidasSinConfirmar.length ? { datos: { recibidasSinConfirmar } } : {}),
            fecha: now,
          })],
          set,
        });
        await syncRequisicionSolicitudesSafe(tenantId, updated, { actorId: actor.userId });
        // 3.4(b): the responsible of each solicitud that became Disponible through the cancel is told ("Ya puedes instalarlo").
        for (const l of toClose) {
          if (l.origenSolicitudRepuestoId) {
            notifyRequisicion(tenantId, 'requisicion.delivery.confirmed', updated, {
              actorId: actor.userId, actorName: actor.name, lineaIds: [sid(l.lineaId)], descripcion: l.descripcion,
            });
          }
        }
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
