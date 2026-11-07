import { Requisicion, buildTimelineEvent } from '../models/requisicion.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import { requisicionRecepcionService } from './requisicionRecepcion.service.js';
import {
  ENTREGA_ARCHIVO_ORIGEN as ORIGEN,
  ENTREGA_ESTADO as EN,
  ENTREGA_MAX_ARCHIVOS,
  ENTREGA_MAX_ARCHIVOS_POR_SUBIDA,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../constants/requisicion.constants.js';
import { assertModule, loadRequisicion, trimStr } from './requisicionLicitacion.shared.js';

/**
 * Supplier deliverables of the purchase order (change: requisiciones-e4-oc-recepcion, task 2.1). The delivery is a
 * SUB-STATE (`ordenCompra.entrega.estado`), never a header state, so the physical reception (E2) and the documents do not
 * mix. Cycle: Pendiente -> Recibidos (first upload or manual) -> En_Revision -> Aceptados | Devolucion -> (re-upload)
 * Recibidos ... without limit; every step is a timeline event.
 *
 * Every write is ONE conditional `Requisicion.appendEvent` whose filter pins the header state, the OC and the current
 * delivery state (no read-modify-write). Files are validated by magic bytes in the storage service (same rules as a
 * quotation file), capped per request and per delivery, and removed from storage when the write does not land.
 */

const OPEN_ESTADOS = [E.OC_ENVIADA, E.EN_RECEPCION];
/** Delivery states in which the supplier (or a user on his behalf) can attach files. */
const UPLOADABLE = [EN.PENDIENTE, EN.RECIBIDOS, EN.DEVOLUCION];
/** Delivery states a reviewer can decide from (`Recibidos` is reviewed implicitly: the review step is recorded too). */
const REVIEWABLE = [EN.RECIBIDOS, EN.EN_REVISION];

const conflict = (message, code = 'CONFLICTO_CONCURRENTE') => new ApiError(409, message, code);

export class RequisicionEntregablesService {
  // Seam for tests (ESM bindings are immutable).
  deps = { storage: firebaseStorageService, notify: notifyRequisicion, recepcion: requisicionRecepcionService };

  /** Common preconditions: OC exists, requires deliverables, requisition in a state that admits them. */
  _assertEntrega(doc, allowed) {
    const oc = doc.ordenCompra;
    if (!oc?.numero) throw new ApiError(404, 'La requisición no tiene orden de compra', 'ORDEN_COMPRA_NOT_FOUND');
    if (!oc.requiereEntregables) throw conflict('La orden de compra no exige entregables', 'ENTREGABLES_NO_REQUERIDOS');
    if (!OPEN_ESTADOS.includes(doc.estado)) {
      throw new ApiError(409, `La requisición está en estado ${doc.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
    const actual = oc.entrega?.estado || EN.PENDIENTE;
    if (!allowed.includes(actual)) {
      throw new ApiError(409, `La entrega está en estado ${actual} y no admite esta operación`, 'ENTREGA_ESTADO_INVALIDO', { entregaActual: actual });
    }
    return actual;
  }

  async _cleanup(uploaded = []) {
    for (const u of uploaded) {
      if (!u?.storagePath) continue;
      try { await this.deps.storage.deleteByPath(u.storagePath); } catch (e) { logger.warn('requisicion entregable cleanup failed', { err: String(e) }); }
    }
  }

  // ------------------------------------------------------------------------------------------ upload

  /**
   * Stores the files and appends them in ONE conditional write. `by` = { origen, usuarioId?, externo?, pin? }: `pin` adds the
   * portal condition on the winner's entry (token hash). Returns the updated document or throws.
   */
  async _subirArchivos(tenantId, id, files, by) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) throw new ApiError(400, 'Adjunta al menos un archivo', 'ARCHIVOS_REQUERIDOS');
    if (list.length > ENTREGA_MAX_ARCHIVOS_POR_SUBIDA) {
      throw new ApiError(400, `Máximo ${ENTREGA_MAX_ARCHIVOS_POR_SUBIDA} archivos por envío`, 'ENTREGABLES_LIMIT_EXCEEDED');
    }
    const doc = await loadRequisicion(tenantId, id);
    const prevEstado = this._assertEntrega(doc, UPLOADABLE);
    const actual = (doc.ordenCompra.entrega?.archivos || []).length;
    if (actual + list.length > ENTREGA_MAX_ARCHIVOS) {
      throw new ApiError(400, `La entrega admite máximo ${ENTREGA_MAX_ARCHIVOS} archivos`, 'ENTREGABLES_LIMIT_EXCEEDED');
    }
    const uploaded = [];
    let done = false;
    try {
      for (const f of list) {
        uploaded.push(await this.deps.storage.uploadRequisicionEntregable(f.buffer, f.originalname, f.mimetype, { tenantId, requisicionId: String(id) }));
      }
      const now = new Date();
      const archivos = uploaded.map((u) => ({
        url: u.url, nombre: u.nombre, tipo: u.tipo, tamano: u.tamano, storagePath: u.storagePath,
        subidoPor: by.origen, ...(by.usuarioId ? { usuarioId: by.usuarioId } : {}), fecha: now,
      }));
      const updated = await Requisicion.appendEvent(
        {
          _id: id,
          tenantId,
          estado: { $in: OPEN_ESTADOS },
          'ordenCompra.requiereEntregables': true,
          'ordenCompra.entrega.estado': prevEstado,
          // room under the per-delivery cap (the write fails instead of exceeding it)
          [`ordenCompra.entrega.archivos.${ENTREGA_MAX_ARCHIVOS - list.length}`]: { $exists: false },
          ...(by.pin || {}),
        },
        buildTimelineEvent({
          tipo: EV.ENTREGABLES_RECIBIDOS,
          actorId: by.usuarioId || null,
          actorExterno: by.externo || null,
          estadoAnterior: doc.estado,
          estadoNuevo: doc.estado,
          fecha: now,
          datos: { numero: doc.ordenCompra.numero, archivos: archivos.length, origen: by.origen, nombres: archivos.map((a) => a.nombre), reentrega: prevEstado === EN.DEVOLUCION },
        }),
        {
          set: {
            'ordenCompra.entrega.estado': EN.RECIBIDOS,
            'ordenCompra.entrega.recibidosAt': now,
            // a new delivery restarts the reminder cycle
            'ordenCompra.entrega.ultimoRecordatorio': null,
          },
          push: { 'ordenCompra.entrega.archivos': { $each: archivos } },
        },
      );
      if (!updated) {
        throw conflict('La entrega cambió mientras se subían los archivos; recarga e intenta de nuevo');
      }
      done = true;
      return updated;
    } finally {
      if (!done) await this._cleanup(uploaded);
    }
  }

  /** Internal: a user with manage-deliverables attaches files on behalf of the supplier. */
  async subir(tenantId, id, actor, files, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const updated = await this._subirArchivos(tenantId, id, files, { origen: ORIGEN.USUARIO, usuarioId: actor.userId });
    const fresh = updated.toObject();
    this.deps.notify(tenantId, 'requisicion.deliverables.received', fresh, { actorId: actor.userId, actorName: actor.name, ocNumero: fresh.ordenCompra?.numero });
    return toPublicPopulated(fresh);
  }

  /**
   * Portal: the WINNER uploads through his personal link. `ctx` is the resolved portal context; the write also pins the
   * winner's entry and token hash, so a rotated / foreign token can never land a file. Returns the updated document.
   */
  async subirDesdePortal(ctx, files) {
    const { row } = ctx;
    const updated = await this._subirArchivos(String(row.tenantId), row._id, files, {
      origen: ORIGEN.PROVEEDOR,
      externo: { nombre: row.proveedor.nombre },
      pin: {
        'licitacion.ganadorId': row.proveedor._id,
        'licitacion.proveedores': { $elemMatch: { _id: row.proveedor._id, tokenHash: ctx.hash } },
      },
    });
    const fresh = updated.toObject();
    this.deps.notify(String(row.tenantId), 'requisicion.deliverables.received', fresh, { actorId: null, proveedorNombre: row.proveedor.nombre, ocNumero: fresh.ordenCompra?.numero });
    return fresh;
  }

  // ------------------------------------------------------------------------------------------ review

  /**
   * One conditional transition of the delivery state. `from` are the allowed current delivery states (pinned in the write).
   * @returns {Promise<{ updated: object, doc: object, prev: string }>}
   */
  async _paso(tenantId, id, from, buildEvents, set) {
    const doc = await loadRequisicion(tenantId, id);
    const prev = this._assertEntrega(doc, from);
    const now = new Date();
    const updated = await Requisicion.appendEvent(
      {
        _id: id,
        tenantId,
        estado: doc.estado,
        'ordenCompra.requiereEntregables': true,
        'ordenCompra.entrega.estado': prev,
        'ordenCompra.version': doc.ordenCompra.version,
      },
      buildEvents({ doc, prev, now }),
      { set: set({ now }) },
    );
    if (!updated) throw conflict('La entrega cambió mientras se procesaba la operación; recarga e intenta de nuevo');
    return { updated, doc, prev };
  }

  /** Manual: the buyer confirms he already has the supports (e-mail, in person) without attaching files. */
  async marcarRecibidos(tenantId, id, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const { updated } = await this._paso(
      tenantId, id, [EN.PENDIENTE, EN.DEVOLUCION],
      ({ doc, prev, now }) => buildTimelineEvent({
        tipo: EV.ENTREGABLES_RECIBIDOS, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: doc.estado, fecha: now,
        datos: { numero: doc.ordenCompra.numero, manual: true, origen: ORIGEN.USUARIO, reentrega: prev === EN.DEVOLUCION },
      }),
      ({ now }) => ({ 'ordenCompra.entrega.estado': EN.RECIBIDOS, 'ordenCompra.entrega.recibidosAt': now, 'ordenCompra.entrega.ultimoRecordatorio': null }),
    );
    return toPublicPopulated(updated);
  }

  async revisar(tenantId, id, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const { updated } = await this._paso(
      tenantId, id, [EN.RECIBIDOS],
      ({ doc, now }) => buildTimelineEvent({
        tipo: EV.PASO_REVISION_ENTREGA, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: doc.estado, fecha: now,
        datos: { numero: doc.ordenCompra.numero },
      }),
      () => ({ 'ordenCompra.entrega.estado': EN.EN_REVISION }),
    );
    return toPublicPopulated(updated);
  }

  /** Review step recorded when the decision is taken straight from `Recibidos`. */
  _reviewEvents({ doc, prev, now }, actor) {
    return prev === EN.RECIBIDOS
      ? [buildTimelineEvent({
        tipo: EV.PASO_REVISION_ENTREGA, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: doc.estado, fecha: now,
        datos: { numero: doc.ordenCompra.numero },
      })]
      : [];
  }

  async aceptar(tenantId, id, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const { updated, doc } = await this._paso(
      tenantId, id, REVIEWABLE,
      (c) => [
        ...this._reviewEvents(c, actor),
        buildTimelineEvent({
          tipo: EV.ENTREGABLES_ACEPTADOS, actorId: actor.userId, estadoAnterior: c.doc.estado, estadoNuevo: c.doc.estado, fecha: c.now,
          datos: { numero: c.doc.ordenCompra.numero, archivos: (c.doc.ordenCompra.entrega?.archivos || []).length },
        }),
      ],
      ({ now }) => ({ 'ordenCompra.entrega.estado': EN.ACEPTADOS, 'ordenCompra.entrega.aceptadosAt': now }),
    );
    const fresh = updated.toObject();
    this.deps.notify(tenantId, 'requisicion.deliverables.accepted', fresh, { actorId: actor.userId, actorName: actor.name, ocNumero: doc.ordenCompra.numero });
    // Accepting the last pending document may close the requisition (E2 close + E4 deliverables rule).
    const closed = await this.deps.recepcion.closeIfDone(tenantId, id, actor);
    return toPublicPopulated(closed || fresh);
  }

  async devolver(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    const observacion = trimStr(data.observacion);
    if (!observacion) throw new ApiError(400, 'La observación es obligatoria para devolver los entregables', 'OBSERVACION_REQUERIDA');
    await assertModule(tenantId, capabilities);
    const { updated, doc } = await this._paso(
      tenantId, id, REVIEWABLE,
      (c) => [
        ...this._reviewEvents(c, actor),
        buildTimelineEvent({
          tipo: EV.DEVUELTA, actorId: actor.userId, estadoAnterior: c.doc.estado, estadoNuevo: c.doc.estado, fecha: c.now, observacion,
          datos: { numero: c.doc.ordenCompra.numero, archivos: (c.doc.ordenCompra.entrega?.archivos || []).length },
        }),
      ],
      ({ now }) => ({
        'ordenCompra.entrega.estado': EN.DEVOLUCION,
        'ordenCompra.entrega.ultimaObservacion': observacion,
        'ordenCompra.entrega.devueltaAt': now,
        'ordenCompra.entrega.ultimoRecordatorio': null,
      }),
    );
    const fresh = updated.toObject();
    this.deps.notify(tenantId, 'requisicion.deliverables.returned', fresh, { actorId: actor.userId, actorName: actor.name, reason: observacion, ocNumero: doc.ordenCompra.numero });
    return toPublicPopulated(fresh);
  }
}

export const requisicionEntregablesService = new RequisicionEntregablesService();
