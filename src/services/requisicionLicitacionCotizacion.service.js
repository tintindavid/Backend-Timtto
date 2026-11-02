import { Requisicion, buildTimelineEvent } from '../models/requisicion.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { toCotizacionDto } from '../utils/requisicionLicitacionDto.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { transition } from './requisicionTransition.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import {
  COTIZACION_MAX_VERSIONES,
  COTIZACION_ORIGEN,
  PROVEEDOR_ENLACE_POST_CIERRE_DIAS,
  PROVEEDOR_ESTADO_ENVIO as PE,
  PROVEEDOR_ESTADOS_ACTIVOS,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../constants/requisicion.constants.js';
import { assertEstado, assertModule, findProveedor, isActivo, loadRequisicion, oidOf, proveedoresOf, sid, trimStr } from './requisicionLicitacion.shared.js';

/**
 * Quotations of the tender: internal registration, closing the quotation window (manual or automatic) and the
 * comparison (change: requisiciones-e3-compras-portal, task 2.2). The portal reuses `normalizeCotizacionInput` and
 * `writeCotizacion` so a quotation is validated and stored the same way whoever submits it.
 */

const MAX_ATTEMPTS = 3;

/** Validates the quotation fields (already coerced by the DTO). Returns only the defined fields. */
export function normalizeCotizacionInput(data = {}, hasFile = false) {
  const out = {};
  const link = trimStr(data.linkPropuesta);
  if (link) {
    let url;
    try { url = new URL(link); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || link.length > 2000 || /\s/.test(link)) {
      throw new ApiError(400, 'El enlace de la propuesta debe ser una dirección https:// válida', 'LINK_INVALIDO');
    }
    out.linkPropuesta = link;
  }
  const obs = trimStr(data.observacion);
  if (obs) out.observacion = obs.slice(0, 2000);
  if (data.valorTotal !== undefined && data.valorTotal !== null && data.valorTotal !== '') {
    const v = Number(data.valorTotal);
    if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'El valor total debe ser un número mayor o igual a cero', 'VALOR_INVALIDO');
    out.valorTotal = v;
  }
  const moneda = trimStr(data.moneda).toUpperCase();
  if (moneda) {
    if (!/^[A-Z]{3}$/.test(moneda)) throw new ApiError(400, 'La moneda no es válida', 'MONEDA_INVALIDA');
    out.moneda = moneda;
  }
  if (data.tiempoEntregaDias !== undefined && data.tiempoEntregaDias !== null && data.tiempoEntregaDias !== '') {
    const t = Number(data.tiempoEntregaDias);
    if (!Number.isInteger(t) || t < 0 || t > 3650) throw new ApiError(400, 'El tiempo de entrega debe ser un número entero de días', 'TIEMPO_ENTREGA_INVALIDO');
    out.tiempoEntregaDias = t;
  }
  if (!hasFile && !out.linkPropuesta && !out.observacion) {
    throw new ApiError(400, 'La cotización debe incluir un archivo, un enlace o una observación', 'COTIZACION_VACIA');
  }
  return out;
}

const VERSION_FIELDS = ['fechaRespuesta', 'archivo', 'linkPropuesta', 'observacion', 'valorTotal', 'moneda', 'origen'];

/**
 * Pushes the previous quotation into `versiones` (cap 10). Returns the new quotation and the versions that fell off the
 * cap (their files must be deleted, best effort, after the write succeeded).
 */
export function withHistory(prev, cotizacion) {
  if (!prev) return { cotizacion, dropped: [] };
  const snap = {};
  for (const k of VERSION_FIELDS) if (prev[k] !== undefined && prev[k] !== null) snap[k] = prev[k];
  const all = [...(prev.versiones || []), snap];
  const dropped = all.slice(0, Math.max(0, all.length - COTIZACION_MAX_VERSIONES));
  return { cotizacion: { ...cotizacion, versiones: all.slice(-COTIZACION_MAX_VERSIONES) }, dropped };
}

/** Best-effort deletion of the Firebase files of dropped versions (never throws). */
export async function deleteDroppedFiles(storage, dropped = []) {
  for (const v of dropped) {
    const path = v?.archivo?.storagePath;
    if (!path) continue;
    try { await storage.deleteByPath(path); } catch (e) { logger.warn('requisicion cotizacion: old version file not deleted', { err: String(e) }); }
  }
}

/**
 * ONE conditional write that stores the quotation of a supplier (the last one prevails; every submission is kept in the
 * timeline) and leaves it `Aceptado`. Returns null when the guard missed (state / supplier / deadline changed).
 * `elemMatch` adds conditions on the supplier element (the portal pins `tokenHash` there); `filter` on the document.
 */
export function writeCotizacion(tenantId, id, pid, { cotizacion, event, elemMatch = {}, filter = {}, allowedEstados, prev = null }) {
  // The history is rebuilt from the quotation the caller read: the write only lands if that one is still the stored one.
  const prevGuard = prev ? { 'cotizacion.fechaRespuesta': prev.fechaRespuesta } : { cotizacion: { $exists: false } };
  return Requisicion.appendEvent(
    {
      _id: id,
      tenantId,
      estado: E.EN_LICITACION,
      ...filter,
      'licitacion.proveedores': { $elemMatch: { _id: pid, estadoEnvio: { $in: allowedEstados }, ...prevGuard, ...elemMatch } },
    },
    event,
    {
      set: { 'licitacion.proveedores.$[p].cotizacion': cotizacion, 'licitacion.proveedores.$[p].estadoEnvio': PE.ACEPTADO },
      arrayFilters: [{ 'p._id': pid }],
    },
  );
}

export class RequisicionLicitacionCotizacionService {
  deps = { storage: firebaseStorageService, notify: notifyRequisicion };

  async _cleanup(uploaded) {
    if (!uploaded?.storagePath) return;
    try { await this.deps.storage.deleteByPath(uploaded.storagePath); } catch (e) { logger.warn('requisicion cotizacion cleanup failed', { err: String(e) }); }
  }

  /** A buyer registers a quotation received by another channel (e-mail, phone). `file` is a multer memory file or null. */
  async registrarCotizacion(tenantId, id, paId, actor, data = {}, file = null, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.EN_LICITACION]);
    const p = findProveedor(doc, paId);
    if (!isActivo(p)) throw new ApiError(409, 'El proveedor ya no está activo en la licitación', 'PROVEEDOR_INACTIVO');
    const fields = normalizeCotizacionInput(data, Boolean(file));
    let uploaded = null;
    let done = false;
    try {
      if (file) uploaded = await this.deps.storage.uploadRequisicionCotizacion(file.buffer, file.originalname, file.mimetype, { tenantId, requisicionId: String(id) });
      const { cotizacion, dropped } = withHistory(p.cotizacion, {
        ...fields,
        ...(uploaded ? { archivo: { url: uploaded.url, nombre: uploaded.nombre, tipo: uploaded.tipo, tamano: uploaded.tamano, storagePath: uploaded.storagePath } } : {}),
        fechaRespuesta: new Date(),
        origen: COTIZACION_ORIGEN.INTERNO,
        registradaPor: actor.userId,
      });
      const updated = await writeCotizacion(tenantId, id, oidOf(p._id), {
        cotizacion,
        prev: p.cotizacion,
        allowedEstados: PROVEEDOR_ESTADOS_ACTIVOS,
        event: buildTimelineEvent({
          tipo: EV.COTIZACION_RECIBIDA, actorId: actor.userId, estadoAnterior: E.EN_LICITACION, estadoNuevo: E.EN_LICITACION,
          datos: { paId: sid(p._id), nombre: p.nombre, origen: COTIZACION_ORIGEN.INTERNO, conArchivo: Boolean(uploaded), conLink: Boolean(fields.linkPropuesta) },
        }),
      });
      if (!updated) throw new ApiError(409, 'La requisición o el proveedor cambiaron mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
      done = true;
      await deleteDroppedFiles(this.deps.storage, dropped);
      const fresh = updated.toObject();
      this.deps.notify(tenantId, 'requisicion.quote.received', fresh, { actorId: actor.userId, actorName: actor.name, proveedorNombre: p.nombre });
      const closed = await this.maybeAutoClose(tenantId, id, { userId: null });
      return toPublicPopulated(closed || fresh);
    } finally {
      if (!done) await this._cleanup(uploaded);
    }
  }

  // ------------------------------------------------------------------------------------------ closing

  async cerrar(tenantId, id, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const doc = await loadRequisicion(tenantId, id);
      assertEstado(doc, [E.EN_LICITACION]);
      if (!proveedoresOf(doc).some((p) => p.cotizacion)) throw new ApiError(409, 'No hay ninguna cotización registrada para cerrar', 'SIN_COTIZACIONES');
      try {
        return await toPublicPopulated(await this._cerrar(tenantId, id, doc, actor, false));
      } catch (err) {
        if (err.code === 'CONFLICTO_CONCURRENTE') continue;
        throw err;
      }
    }
    throw new ApiError(409, 'La requisición cambió mientras se cerraban las cotizaciones; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
  }

  /** En_Licitacion -> Cotizacion_Recibida in ONE write; the links of the suppliers that did not quote expire. */
  async _cerrar(tenantId, id, doc, actor, automatico) {
    const now = new Date();
    const list = proveedoresOf(doc);
    const cotizaciones = list.filter((p) => p.cotizacion).length;
    return transition(tenantId, id, {
      from: E.EN_LICITACION,
      to: E.COTIZACION_RECIBIDA,
      extraFilter: { 'licitacion.proveedores': { $elemMatch: { cotizacion: { $exists: true } } } },
      events: [buildTimelineEvent({
        tipo: EV.COTIZACIONES_CERRADAS, actorId: actor?.userId || null, estadoAnterior: E.EN_LICITACION, estadoNuevo: E.COTIZACION_RECIBIDA, fecha: now,
        datos: { cotizaciones, sinRespuesta: list.filter((p) => isActivo(p) && !p.cotizacion).length, automatico },
      })],
      set: {
        'licitacion.cerradaAt': now,
        'licitacion.proveedores.$[x].tokenVence': now,
        // who quoted keeps a read-only page for a while after the close
        'licitacion.proveedores.$[q].tokenVence': new Date(now.getTime() + PROVEEDOR_ENLACE_POST_CIERRE_DIAS * 86400000),
      },
      arrayFilters: [
        { 'x.cotizacion': { $exists: false }, 'x.estadoEnvio': { $in: PROVEEDOR_ESTADOS_ACTIVOS } },
        { 'q.cotizacion': { $exists: true }, 'q.estadoEnvio': { $in: PROVEEDOR_ESTADOS_ACTIVOS } },
      ],
    });
  }

  /**
   * Closes the window automatically when every active supplier has answered (and at least one quoted). Never throws:
   * it runs after the write that triggered it. Returns the updated plain document or null.
   */
  async maybeAutoClose(tenantId, id, actor = { userId: null }) {
    try {
      const doc = await loadRequisicion(tenantId, id);
      if (doc.estado !== E.EN_LICITACION) return null;
      const activos = proveedoresOf(doc).filter(isActivo);
      if (activos.length === 0 || !activos.every((p) => p.cotizacion)) return null;
      const updated = await this._cerrar(tenantId, id, doc, actor, true);
      return typeof updated.toObject === 'function' ? updated.toObject() : updated;
    } catch (err) {
      logger.warn('requisicion tender: automatic close skipped', { tenantId, requisicionId: String(id), err: String(err) });
      return null;
    }
  }

  // ------------------------------------------------------------------------------------------ comparison

  /** Read-only comparison computed in the server with the internal data (never exposed to the portal). */
  async comparativo(tenantId, id) {
    requireTenant(tenantId);
    const doc = await loadRequisicion(tenantId, id);
    const quoted = proveedoresOf(doc).filter((p) => p.cotizacion);
    const monedas = new Set(quoted.map((p) => p.cotizacion.moneda || ''));
    const hayComparables = quoted.length >= 2
      && quoted.every((p) => Number.isFinite(p.cotizacion.valorTotal))
      && monedas.size === 1 && !monedas.has('');
    const min = hayComparables ? Math.min(...quoted.map((p) => p.cotizacion.valorTotal)) : null;
    const proveedores = proveedoresOf(doc).map((p) => {
      const c = toCotizacionDto(p.cotizacion);
      return {
        paId: sid(p._id),
        nombre: p.nombre ?? null,
        estadoEnvio: p.estadoEnvio,
        fechaRespuesta: c?.fechaRespuesta ?? null,
        archivo: c?.archivo ?? null,
        linkPropuesta: c?.linkPropuesta ?? null,
        observacion: c?.observacion ?? null,
        valorTotal: c?.valorTotal ?? null,
        moneda: c?.moneda ?? null,
        tiempoEntregaDias: c?.tiempoEntregaDias ?? null,
        masEconomica: Boolean(hayComparables && p.cotizacion && p.cotizacion.valorTotal === min),
      };
    });
    return { proveedores, hayComparables };
  }
}

export const requisicionLicitacionCotizacionService = new RequisicionLicitacionCotizacionService();
