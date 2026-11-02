import { Requisicion, buildTimelineEvent } from '../models/requisicion.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { normalizeCapabilities } from '../config/tenantCapabilities.config.js';
import { hashToken, isPlausibleToken } from '../utils/requisicionToken.util.js';
import { toPortalDto } from '../utils/requisicionPortalDto.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import { deleteDroppedFiles, normalizeCotizacionInput, requisicionLicitacionCotizacionService, withHistory, writeCotizacion } from './requisicionLicitacionCotizacion.service.js';
import {
  COTIZACION_ORIGEN,
  LICITACION_MAX_VISTAS,
  PORTAL_MENSAJE_NO_ENCONTRADO,
  PORTAL_MENSAJE_TOKEN_EXPIRADO,
  PROVEEDOR_ESTADO_ENVIO as PE,
  PROVEEDOR_ESTADOS_PORTAL,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../constants/requisicion.constants.js';

/**
 * Public supplier portal (change: requisiciones-e3-compras-portal, group 4). NO authentication: the credential is the
 * token of ONE supplier. Security rules, all enforced here:
 *  - the token is looked up by its SHA-256 hash; the database projection returns ONLY the matching supplier entry and the
 *    lines without prices, so data of other suppliers or internal data never reaches this process' memory;
 *  - unknown / malformed token, deleted requisition, inactive tenant or tenant without the module -> the SAME generic 404;
 *  - discarded / refused / expired link or cancelled requisition -> 403 TOKEN_EXPIRADO with a fixed message and no data;
 *  - every access (blocked ones too) is audited as a capped view with the IP (200 kept), without touching `updatedAt`;
 *  - the output is an allowlist (`toPortalDto`) and errors carry fixed messages (no stack, no internals, no token).
 * The route runs the per-IP and per-IP+token limiters BEFORE any call into this service.
 */

const notFound = () => new ApiError(404, PORTAL_MENSAJE_NO_ENCONTRADO, 'NOT_FOUND');
const expired = () => new ApiError(403, PORTAL_MENSAJE_TOKEN_EXPIRADO, 'TOKEN_EXPIRADO');
const vencida = () => new ApiError(403, 'La fecha límite para cotizar ya venció', 'FECHA_LIMITE_VENCIDA');
const conflict = (message, code) => new ApiError(409, message, code);

const VISIBLE_ESTADOS = [E.EN_LICITACION, E.COTIZACION_RECIBIDA, E.ADJUDICADA, E.EN_RECEPCION, E.CERRADA];

export class RequisicionPortalPublicoService {
  // Seam for tests (ESM bindings are immutable).
  deps = { storage: firebaseStorageService, notify: notifyRequisicion, now: () => new Date() };

  /** One aggregate that returns the header, the lines WITHOUT prices and ONLY the supplier owning `hash`. */
  async _fetch(hash) {
    const rows = await Requisicion.aggregate([
      { $match: { 'licitacion.proveedores.tokenHash': hash, isDeleted: { $ne: true } } },
      { $limit: 1 },
      { $project: {
        tenantId: 1,
        consecutivo: 1,
        titulo: 1,
        instrucciones: '$licitacion.instrucciones',
        estado: 1,
        fechaLimiteCotizacion: '$licitacion.fechaLimiteCotizacion',
        items: { $map: {
          input: { $filter: { input: '$lineas', as: 'l', cond: { $ne: ['$$l.estadoLinea', 'Cancelada'] } } },
          as: 'l',
          in: { descripcion: '$$l.descripcion', cantidad: '$$l.cantidadSolicitada', unidad: '$$l.unidad', especificacion: '$$l.especificaciones' },
        } },
        proveedor: { $first: { $filter: { input: '$licitacion.proveedores', as: 'p', cond: { $eq: ['$$p.tokenHash', hash] } } } },
      } },
      { $project: {
        tenantId: 1, consecutivo: 1, titulo: 1, instrucciones: 1, estado: 1, fechaLimiteCotizacion: 1, items: 1,
        'proveedor._id': 1, 'proveedor.nombre': 1, 'proveedor.estadoEnvio': 1, 'proveedor.tokenVence': 1, 'proveedor.cotizacion': 1,
      } },
    ]);
    return rows[0] || null;
  }

  async _recordView(row, ip, bloqueada) {
    try {
      await Requisicion.updateOne(
        { _id: row._id, tenantId: row.tenantId, 'licitacion.proveedores._id': row.proveedor._id },
        {
          $push: { 'licitacion.proveedores.$[p].vistas': { $each: [{ fecha: this.deps.now(), ip: String(ip || '').slice(0, 64), bloqueada }], $slice: -LICITACION_MAX_VISTAS } },
          $inc: { 'licitacion.proveedores.$[p].vistasCount': 1 },
        },
        { arrayFilters: [{ 'p._id': row.proveedor._id }], timestamps: false },
      );
    } catch (err) {
      logger.warn('requisicion portal: view not recorded', { err: String(err) });
    }
  }

  /**
   * Resolves the token of a request into a context, or throws the generic 404 / TOKEN_EXPIRADO. Audits the access.
   * @returns {Promise<{ row: object, hash: string, tenantNombre: string, now: Date, cerrada: boolean, vencida: boolean }>}
   */
  async resolve(token, { ip } = {}) {
    if (!isPlausibleToken(token)) throw notFound(); // a malformed token cannot match: no database access
    const hash = hashToken(token);
    const row = await this._fetch(hash);
    if (!row || !row.proveedor) throw notFound();
    const now = this.deps.now();

    const tenant = await Tenant.findOne({ tenantId: row.tenantId }).select('name status capabilities').lean();
    const tenantOk = Boolean(tenant) && tenant.status === 'active' && normalizeCapabilities(tenant.capabilities).usesRequisiciones;
    // Same answer as an unknown token for an inactive tenant / a requisition that is not (or no longer) a tender.
    if (!tenantOk || !(VISIBLE_ESTADOS.includes(row.estado) || row.estado === E.CANCELADA)) {
      await this._recordView(row, ip, true);
      throw notFound();
    }

    const p = row.proveedor;
    const limite = row.fechaLimiteCotizacion ? new Date(row.fechaLimiteCotizacion) : null;
    const vence = p.tokenVence ? new Date(p.tokenVence) : null;
    // `tokenVence` in the past means expired (403), with ONE documented exception: while the tender is open, a link whose
    // expiry is the deadline itself reads as "closed" (cerrada = true, answers FECHA_LIMITE_VENCIDA), not as expired.
    const atDeadline = row.estado === E.EN_LICITACION && Boolean(limite) && Boolean(vence) && vence.getTime() >= limite.getTime();
    const earlyExpired = Boolean(vence) && vence.getTime() <= now.getTime() && !atDeadline;
    if (row.estado === E.CANCELADA || [PE.RECHAZADO, PE.DESCARTADO].includes(p.estadoEnvio) || earlyExpired) {
      await this._recordView(row, ip, true);
      throw expired();
    }
    await this._recordView(row, ip, false);
    const vencidaPlazo = Boolean(limite) && now.getTime() > limite.getTime();
    return { row, hash, tenantNombre: tenant.name, now, vencida: vencidaPlazo, cerrada: row.estado !== E.EN_LICITACION || vencidaPlazo };
  }

  view(ctx) {
    return toPortalDto(ctx.row, ctx.row.proveedor, { tenantNombre: ctx.tenantNombre, cerrada: ctx.cerrada });
  }

  /** Open + in time is required to answer; otherwise the fixed 403 / 409. */
  _assertAbierta(ctx) {
    if (ctx.row.estado !== E.EN_LICITACION) throw conflict('La recepción de cotizaciones ya está cerrada', 'LICITACION_CERRADA');
    if (ctx.vencida) throw vencida();
  }

  async _fresh(ctx) {
    const row = await this._fetch(ctx.hash);
    if (!row?.proveedor) throw notFound();
    const cerrada = row.estado !== E.EN_LICITACION || (row.fechaLimiteCotizacion && ctx.now.getTime() > new Date(row.fechaLimiteCotizacion).getTime());
    return this.view({ ...ctx, row, cerrada });
  }

  // ------------------------------------------------------------------------------------------ answer the invitation

  async responderInvitacion(ctx, aceptar) {
    this._assertAbierta(ctx);
    const p = ctx.row.proveedor;
    if (p.estadoEnvio !== PE.ENVIADO) throw conflict('La invitación ya fue respondida o aún no está disponible', 'INVITACION_NO_RESPONDIBLE');
    const now = ctx.now;
    const updated = await Requisicion.appendEvent(
      {
        _id: ctx.row._id,
        tenantId: ctx.row.tenantId,
        estado: E.EN_LICITACION,
        'licitacion.fechaLimiteCotizacion': { $gt: now },
        'licitacion.proveedores': { $elemMatch: { _id: p._id, estadoEnvio: PE.ENVIADO, tokenHash: ctx.hash } },
      },
      buildTimelineEvent({
        tipo: aceptar ? EV.INVITACION_ACEPTADA : EV.INVITACION_RECHAZADA,
        actorExterno: { nombre: p.nombre },
        estadoAnterior: E.EN_LICITACION,
        estadoNuevo: E.EN_LICITACION,
        fecha: now,
        datos: { paId: String(p._id), nombre: p.nombre },
      }),
      {
        set: aceptar
          ? { 'licitacion.proveedores.$[p].estadoEnvio': PE.ACEPTADO }
          : { 'licitacion.proveedores.$[p].estadoEnvio': PE.RECHAZADO, 'licitacion.proveedores.$[p].tokenVence': now },
        arrayFilters: [{ 'p._id': p._id }],
      },
    );
    if (!updated) throw conflict('La invitación cambió mientras se procesaba; recarga la página', 'CONFLICTO_CONCURRENTE');
    if (!aceptar) {
      await requisicionLicitacionCotizacionService.maybeAutoClose(ctx.row.tenantId, ctx.row._id, { userId: null });
      return toPortalDto(ctx.row, { ...p, estadoEnvio: PE.RECHAZADO }, { tenantNombre: ctx.tenantNombre, cerrada: true });
    }
    return this._fresh(ctx);
  }

  // ------------------------------------------------------------------------------------------ submit the quotation

  /** Cheap checks done BEFORE a file is buffered (open tender, in time, supplier allowed to quote). */
  assertPuedeCotizar(ctx) {
    this._assertAbierta(ctx);
    if (!PROVEEDOR_ESTADOS_PORTAL.includes(ctx.row.proveedor.estadoEnvio)) throw conflict('La invitación aún no está disponible para cotizar', 'INVITACION_NO_RESPONDIBLE');
  }

  async enviarCotizacion(ctx, data = {}, file = null) {
    this.assertPuedeCotizar(ctx);
    const p = ctx.row.proveedor;
    const fields = normalizeCotizacionInput(data, Boolean(file));
    let uploaded = null;
    let done = false;
    try {
      if (file) uploaded = await this.deps.storage.uploadRequisicionCotizacion(file.buffer, file.originalname, file.mimetype, { tenantId: ctx.row.tenantId, requisicionId: String(ctx.row._id) });
      const { cotizacion, dropped } = withHistory(p.cotizacion, {
        ...fields,
        ...(uploaded ? { archivo: { url: uploaded.url, nombre: uploaded.nombre, tipo: uploaded.tipo, tamano: uploaded.tamano, storagePath: uploaded.storagePath } } : {}),
        fechaRespuesta: ctx.now,
        origen: COTIZACION_ORIGEN.PORTAL,
      });
      const updated = await writeCotizacion(ctx.row.tenantId, ctx.row._id, p._id, {
        cotizacion,
        prev: p.cotizacion,
        allowedEstados: PROVEEDOR_ESTADOS_PORTAL,
        elemMatch: { tokenHash: ctx.hash },
        filter: { 'licitacion.fechaLimiteCotizacion': { $gt: ctx.now } },
        event: buildTimelineEvent({
          tipo: EV.COTIZACION_RECIBIDA,
          actorExterno: { nombre: p.nombre },
          estadoAnterior: E.EN_LICITACION,
          estadoNuevo: E.EN_LICITACION,
          fecha: ctx.now,
          datos: { paId: String(p._id), nombre: p.nombre, origen: COTIZACION_ORIGEN.PORTAL, conArchivo: Boolean(uploaded), conLink: Boolean(fields.linkPropuesta) },
        }),
      });
      if (!updated) throw conflict('La licitación cambió mientras se procesaba tu cotización; recarga la página', 'CONFLICTO_CONCURRENTE');
      done = true;
      await deleteDroppedFiles(this.deps.storage, dropped);
      this.deps.notify(ctx.row.tenantId, 'requisicion.quote.received', updated.toObject(), { actorId: null, proveedorNombre: p.nombre });
      await requisicionLicitacionCotizacionService.maybeAutoClose(ctx.row.tenantId, ctx.row._id, { userId: null });
      return this._fresh(ctx);
    } finally {
      if (!done && uploaded?.storagePath) {
        try { await this.deps.storage.deleteByPath(uploaded.storagePath); } catch (e) { logger.warn('requisicion portal: file cleanup failed', { err: String(e) }); }
      }
    }
  }
}

export const requisicionPortalPublicoService = new RequisicionPortalPublicoService();
