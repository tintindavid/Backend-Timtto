import mongoose from 'mongoose';
import { Requisicion, buildTimelineEvent, computeMontoEstimado } from '../models/requisicion.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { isCapabilityOn, assertCapabilityOn } from '../utils/tenantModules.util.js';
import { runWithTransactionFallback } from '../utils/mongoSession.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { inventarioMovimientoService } from './inventarioMovimiento.service.js';
import { transition } from './requisicionTransition.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import { syncRequisicionSolicitudesSafe } from './requisicionSolicitudSync.service.js';
import {
  CONFIRMACION_RESULTADO as RES,
  LINEA_ESTADO as L,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../constants/requisicion.constants.js';

/**
 * Reception, delivery confirmation and line closing (change: requisiciones-e2-solicitudes-recepcion, groups 3 and 4).
 *
 * Every write is ONE conditional `Requisicion.appendEvent` whose filter pins the state and the exact values of the
 * lines it read (optimistic guard): a racing writer makes the write return null and the operation re-reads and
 * re-validates (so parallel receptions can never exceed the requested quantity, and a confirmation is written once).
 *
 * Stock (Stock advanced + line with `inventarioItemId`): a paired `entrada` + `salida` of the CONFIRMED quantity is
 * registered ONLY when an item is confirmed (net stock zero, the kardex keeps the trace). It runs in the same
 * transaction as the confirmation write when the server supports it; otherwise the movements are compensated.
 */

const RECEIVABLE = [E.APROBADA, E.EN_RECEPCION];
const ACTIVE_LINE = [L.PENDIENTE, L.RECIBIDA_PARCIAL, L.RECIBIDA, L.EN_DISPUTA];
const MAX_ATTEMPTS = 6;

const sid = (v) => (v === null || v === undefined ? '' : String(v?._id ?? v));
const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const oidOf = (v) => new mongoose.Types.ObjectId(String(v));
const trim = (v) => (typeof v === 'string' ? v.trim() : '');
/** Guard value for a numeric field that may be absent in legacy documents. */
const numGuard = (v) => (Number(v) > 0 ? Number(v) : { $in: [0, null] });

class GuardMiss extends Error {}
class StockItemMissing extends Error {}

export function lineGuard(line) {
  return {
    lineas: {
      $elemMatch: {
        lineaId: oidOf(line.lineaId),
        estadoLinea: line.estadoLinea || L.PENDIENTE,
        cantidadRecibida: numGuard(line.cantidadRecibida),
        cantidadConfirmada: numGuard(line.cantidadConfirmada),
      },
    },
  };
}

export class RequisicionRecepcionService {
  // Seam for tests (ESM bindings are immutable).
  deps = {
    startSession: () => mongoose.startSession(),
    storage: firebaseStorageService,
    movimientos: inventarioMovimientoService,
  };

  async _load(tenantId, id) {
    const doc = await Requisicion.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
    return doc;
  }

  /** RAW capability (ENFORCE_TENANT_CAPABILITIES warn/off do not relax it): these writes never run without the module. */
  async _assertModule(tenantId, capabilities) {
    await assertCapabilityOn(tenantId, 'usesRequisiciones', capabilities, 'Tu organización no tiene habilitado el módulo de Requisiciones.');
  }

  _assertEstado(doc, allowed) {
    if (!allowed.includes(doc.estado)) {
      throw new ApiError(409, `La requisición está en estado ${doc.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
    }
  }

  // ------------------------------------------------------------------------------------------ register reception

  _planRecepcion(doc, items) {
    this._assertEstado(doc, RECEIVABLE);
    const seen = new Set();
    return items.map((it) => {
      const key = sid(it.lineaId);
      if (seen.has(key)) throw new ApiError(400, 'Línea repetida en la recepción', 'LINEA_REPETIDA', { lineaId: key });
      seen.add(key);
      const line = (doc.lineas || []).find((l) => sid(l.lineaId) === key);
      if (!line) throw new ApiError(400, 'La línea indicada no pertenece a la requisición', 'LINEA_NO_ENCONTRADA', { lineaId: key });
      if (!ACTIVE_LINE.includes(line.estadoLinea || L.PENDIENTE)) {
        throw new ApiError(409, `La línea está ${line.estadoLinea} y no admite recepciones`, 'LINEA_NO_RECIBIBLE', { lineaId: key, estadoLinea: line.estadoLinea });
      }
      const q = Number(it.cantidadRecibida);
      const prev = Number(line.cantidadRecibida) || 0;
      const total = round6(prev + q);
      if (!(q > 0)) throw new ApiError(400, 'La cantidad recibida debe ser mayor que cero', 'CANTIDAD_INVALIDA', { lineaId: key });
      if (total > Number(line.cantidadSolicitada)) {
        throw new ApiError(400, 'La cantidad acumulada recibida excede la solicitada', 'CANTIDAD_EXCEDE', {
          lineaId: key, solicitada: line.cantidadSolicitada, recibida: prev, intento: q,
        });
      }
      return { line, key, q, total, estadoLinea: total >= Number(line.cantidadSolicitada) ? L.RECIBIDA : L.RECIBIDA_PARCIAL };
    });
  }

  async _uploadEvidencias(tenantId, requisicionId, files = []) {
    const out = [];
    try {
      for (const f of files) {
        out.push(await this.deps.storage.uploadRequisicionEvidencia(f.buffer, f.originalname, f.mimetype, { tenantId, requisicionId: String(requisicionId) }));
      }
    } catch (err) {
      await this._cleanup(out);
      throw err;
    }
    return out;
  }

  async _cleanup(uploaded = []) {
    for (const u of uploaded) {
      try { if (u.storagePath) await this.deps.storage.deleteByPath(u.storagePath); } catch (e) { logger.warn('requisicion evidence cleanup failed', { err: String(e) }); }
    }
  }

  /**
   * @param {{ fecha?: Date|string, documento?: string, observacion?: string, items: {lineaId: string, cantidadRecibida: number}[] }} data
   * @param {{ buffer: Buffer, originalname: string, mimetype: string }[]} files
   */
  async registrar(tenantId, id, actor, data, files = [], capabilities = null) {
    requireTenant(tenantId);
    await this._assertModule(tenantId, capabilities);
    let uploaded = null;
    let done = false;
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const doc = await this._load(tenantId, id);
        const plan = this._planRecepcion(doc, data.items || []);
        if (uploaded === null) uploaded = await this._uploadEvidencias(tenantId, id, files);

        const recepcionId = new mongoose.Types.ObjectId();
        const documento = trim(data.documento);
        const observacion = trim(data.observacion);
        const recepcion = {
          recepcionId,
          fecha: data.fecha ? new Date(data.fecha) : new Date(),
          recibidaPor: actor.userId,
          ...(documento ? { documento } : {}),
          ...(observacion ? { observacion } : {}),
          evidencias: uploaded.map(({ nombre, url, tipo }) => ({ nombre, url, tipo })),
          items: plan.map((p) => ({ lineaId: oidOf(p.key), cantidadRecibida: p.q })),
        };
        const set = { estado: E.EN_RECEPCION };
        const arrayFilters = [];
        plan.forEach((p, i) => {
          set[`lineas.$[l${i}].estadoLinea`] = p.estadoLinea;
          set[`lineas.$[l${i}].cantidadRecibida`] = p.total;
          arrayFilters.push({ [`l${i}.lineaId`]: oidOf(p.key) });
        });
        const updated = await Requisicion.appendEvent(
          { _id: id, tenantId, estado: { $in: RECEIVABLE }, $and: plan.map((p) => lineGuard(p.line)) },
          [buildTimelineEvent({
            tipo: EV.RECEPCION_REGISTRADA,
            actorId: actor.userId,
            estadoAnterior: doc.estado,
            estadoNuevo: E.EN_RECEPCION,
            observacion: observacion || undefined,
            datos: {
              recepcionId: String(recepcionId),
              documento: documento || undefined,
              items: plan.map((p) => ({ lineaId: p.key, descripcion: p.line.descripcion, cantidadRecibida: p.q })),
            },
          })],
          { set, arrayFilters, pushRecepciones: recepcion },
        );
        if (!updated) continue; // somebody wrote in between: re-read and re-validate
        done = true;
        const fresh = typeof updated.toObject === 'function' ? updated.toObject() : updated;
        await syncRequisicionSolicitudesSafe(tenantId, fresh, { actorId: actor.userId });
        notifyRequisicion(tenantId, 'requisicion.delivery.registered', fresh, {
          actorId: actor.userId,
          actorName: actor.name,
          lineaIds: plan.map((p) => p.key),
          descripcion: plan.map((p) => p.line.descripcion).slice(0, 3).join(', '),
        });
        return toPublicPopulated(fresh);
      }
      throw new ApiError(409, 'La requisición cambió mientras se registraba la recepción; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
    } finally {
      if (!done && uploaded) await this._cleanup(uploaded);
    }
  }

  // ------------------------------------------------------------------------------------------ confirm delivery

  async _responsibleByLine(tenantId, doc) {
    // The responsible is the SNAPSHOT taken when the line was created from the solicitud (`responsableId`): later edits
    // of the solicitud cannot change who confirms. Only legacy lines without snapshot read the solicitud.
    const map = new Map();
    for (const l of doc.lineas || []) if (l.responsableId) map.set(sid(l.lineaId), sid(l.responsableId));
    const origenIds = (doc.lineas || []).filter((l) => !l.responsableId).map((l) => sid(l.origenSolicitudRepuestoId)).filter(Boolean);
    if (origenIds.length > 0) {
      const sols = await Repuestos.find({ tenantId, _id: { $in: origenIds } }).select('ResponsableSolicitud').lean();
      const byId = new Map(sols.map((s) => [sid(s._id), sid(s.ResponsableSolicitud)]));
      for (const l of doc.lineas || []) {
        const o = l.responsableId ? '' : sid(l.origenSolicitudRepuestoId);
        if (o) map.set(sid(l.lineaId), byId.get(o) || '');
      }
    }
    for (const l of doc.lineas || []) if (!map.has(sid(l.lineaId))) map.set(sid(l.lineaId), sid(doc.solicitanteId));
    return map;
  }

  _validateConfirmItems(doc, rec, items, actor, responsible) {
    const seen = new Set();
    return items.map((it) => {
      const key = sid(it.lineaId);
      if (seen.has(key)) throw new ApiError(400, 'Ítem repetido en la confirmación', 'LINEA_REPETIDA', { lineaId: key });
      seen.add(key);
      const recItem = (rec.items || []).find((i) => sid(i.lineaId) === key);
      if (!recItem) throw new ApiError(404, 'La recepción no contiene esa línea', 'ITEM_NO_ENCONTRADO', { lineaId: key });
      const selfReceived = sid(rec.recibidaPor) === sid(actor.userId);
      const notResponsible = responsible.get(key) !== sid(actor.userId);
      if (!actor.canManageAll && selfReceived) {
        throw new ApiError(403, 'Quien registró la recepción no puede confirmar sus propios ítems', 'SEPARACION_FUNCIONES', { lineaId: key });
      }
      if (!actor.canManageAll && notResponsible) {
        throw new ApiError(403, 'Solo el responsable de la solicitud puede confirmar la entrega', 'NO_ES_RESPONSABLE', { lineaId: key });
      }
      // Audit marker: manage-all is allowed to bypass both checks (design decision 6, "Excepciones"), and it is recorded.
      const porManageAll = Boolean(actor.canManageAll && (selfReceived || notResponsible));
      if (recItem.confirmacion) {
        // Retry of a multi-item confirmation: the same actor re-sending the same outcome is already done (idempotent).
        const given = it.cantidad !== undefined ? Number(it.cantidad)
          : (it.resultado === RES.RECIBIDO ? Number(recItem.cantidadRecibida) : (it.resultado === RES.INCOMPLETO ? undefined : 0));
        const done = { key, resultado: it.resultado, cantidad: given, observacion: trim(it.observacion), porManageAll };
        if (this._isSameConfirmation(recItem.confirmacion, actor, done)) return { ...done, done: true };
        throw new ApiError(409, 'El ítem ya fue confirmado', 'ENTREGA_YA_CONFIRMADA', { lineaId: key });
      }

      const q = Number(recItem.cantidadRecibida);
      const observacion = trim(it.observacion);
      let cantidad = it.cantidad;
      if (it.resultado === RES.RECIBIDO) {
        cantidad = cantidad === undefined ? q : Number(cantidad);
        if (cantidad !== q) throw new ApiError(400, 'Al confirmar «Recibido» la cantidad debe ser la recibida', 'CANTIDAD_INVALIDA', { lineaId: key, esperada: q });
      } else if (it.resultado === RES.INCOMPLETO) {
        if (cantidad === undefined || !(Number(cantidad) > 0 && Number(cantidad) < q)) {
          throw new ApiError(400, 'En «Llegó incompleto» la cantidad debe ser mayor que cero y menor que la recibida', 'CANTIDAD_INVALIDA', { lineaId: key, recibida: q });
        }
        cantidad = Number(cantidad);
        if (!observacion) throw new ApiError(400, 'La observación es obligatoria cuando la entrega no está completa', 'OBSERVACION_REQUERIDA', { lineaId: key });
      } else {
        cantidad = cantidad === undefined ? 0 : Number(cantidad);
        if (cantidad !== 0) throw new ApiError(400, 'En «No llegó» la cantidad debe ser cero', 'CANTIDAD_INVALIDA', { lineaId: key });
        if (!observacion) throw new ApiError(400, 'La observación es obligatoria cuando la entrega no llegó', 'OBSERVACION_REQUERIDA', { lineaId: key });
      }
      return { key, resultado: it.resultado, cantidad, observacion, porManageAll };
    });
  }

  /** Same actor and same outcome (result + quantity) as the stored confirmation. */
  _isSameConfirmation(conf, actor, p) {
    return sid(conf.por) === sid(actor.userId)
      && conf.resultado === p.resultado
      && p.cantidad !== undefined
      && Number(conf.cantidad ?? 0) === Number(p.cantidad);
  }

  _stockMoves(doc, line, cantidad) {
    if (!line.inventarioItemId || !(cantidad > 0)) return [];
    const base = { itemId: line.inventarioItemId, cantidad, referenciaTipo: 'requisicion', referenciaId: String(doc._id) };
    return [
      { ...base, tipo: 'entrada', motivo: `Entrada por entrega confirmada de la requisición ${doc.consecutivo}` },
      { ...base, tipo: 'salida', motivo: `Salida por entrega confirmada de la requisición ${doc.consecutivo}` },
    ];
  }

  async _reverse(tenantId, applied, actor, consecutivo) {
    for (const m of [...applied].reverse()) {
      try {
        await this.deps.movimientos.create(tenantId, {
          ...m,
          tipo: m.tipo === 'entrada' ? 'salida' : 'entrada',
          motivo: `Reversa por fallo al confirmar la requisición ${consecutivo}`,
        }, actor.userId);
      } catch (err) {
        logger.error('requisicion stock compensation failed, manual adjustment needed', { tenantId, itemId: sid(m.itemId), err: String(err) });
      }
    }
  }

  /**
   * `Repuestos.stockDescontadoPor = 'requisicion'` marker (OT completion skips the discount of marked solicitudes).
   * `set` returns true only when THIS call wrote it (so `unset` never clears a marker of an earlier confirmation).
   */
  _stockMarker(tenantId, requisicionId, solicitudId) {
    const filter = { _id: solicitudId, tenantId, 'requisicion.requisicionId': oidOf(requisicionId) };
    return {
      set: async (sess) => {
        const r = await Repuestos.updateOne({ ...filter, stockDescontadoPor: { $ne: 'requisicion' } }, { $set: { stockDescontadoPor: 'requisicion' } }, sess ? { session: sess } : {});
        return Number(r?.modifiedCount) === 1;
      },
      unset: async () => {
        try {
          await Repuestos.updateOne({ ...filter, stockDescontadoPor: 'requisicion' }, { $unset: { stockDescontadoPor: 1 } });
        } catch (err) {
          logger.error('requisicion: could not clear stockDescontadoPor after a failed confirmation', { tenantId, requisicionId: String(requisicionId), err: String(err) });
        }
      },
    };
  }

  /**
   * Runs the stock moves and the guarded write together; null when the guard missed (everything undone).
   * The stock marker travels with them: in the SAME transaction when there is a session; without one it is written
   * BEFORE the stock pair and cleared on any failure, so stock can never be discounted without the marker.
   */
  async _writeWithStock(tenantId, moves, actor, consecutivo, writeFn, marker = null) {
    if (moves.length === 0) return writeFn(null);
    const session = await this.deps.startSession();
    const run = async (sess) => {
      const applied = [];
      let marked = false;
      try {
        if (marker && !sess) marked = await marker.set(null);
        for (const m of moves) {
          try {
            await this.deps.movimientos.create(tenantId, m, actor.userId, sess ? { session: sess } : {});
          } catch (err) {
            // The stock item was deleted / is missing: signal it so the confirmation proceeds without stock (B4).
            if (applied.length === 0 && err instanceof ApiError && err.statusCode === 404 && err.code === 'NOT_FOUND') throw new StockItemMissing();
            if (err instanceof ApiError) {
              throw new ApiError(409, `No se pudo registrar el movimiento de stock: ${err.message}`, 'STOCK_MOVIMIENTO_FALLIDO', { causa: err.code });
            }
            throw err;
          }
          applied.push(m);
        }
        if (marker && sess) await marker.set(sess);
        const updated = await writeFn(sess);
        if (!updated) throw new GuardMiss();
        return updated;
      } catch (err) {
        if (!sess) {
          await this._reverse(tenantId, applied, actor, consecutivo);
          if (marked) await marker.unset();
        }
        throw err;
      }
    };
    try {
      return session ? await runWithTransactionFallback(session, run) : await run(null);
    } catch (err) {
      if (err instanceof GuardMiss) return null;
      throw err;
    } finally {
      if (session) await session.endSession();
    }
  }

  async _confirmOne(tenantId, id, recepcionId, p, actor, stockOn) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const doc = await this._load(tenantId, id);
      const rec = (doc.recepciones || []).find((r) => sid(r.recepcionId) === sid(recepcionId));
      if (!rec) throw new ApiError(404, 'Recepción no encontrada', 'RECEPCION_NOT_FOUND', { recepcionId });
      const recItem = (rec.items || []).find((i) => sid(i.lineaId) === p.key);
      if (!recItem) throw new ApiError(404, 'La recepción no contiene esa línea', 'ITEM_NO_ENCONTRADO', { lineaId: p.key });
      const line = (doc.lineas || []).find((l) => sid(l.lineaId) === p.key);
      if (!line) throw new ApiError(400, 'La línea indicada no pertenece a la requisición', 'LINEA_NO_ENCONTRADA', { lineaId: p.key });
      // Idempotency BEFORE the state check: retrying the confirmation that closed the requisition is a success (A5).
      if (!recItem.confirmacion) this._assertEstado(doc, [E.EN_RECEPCION]);
      if (recItem.confirmacion) {
        if (!this._isSameConfirmation(recItem.confirmacion, actor, p)) throw new ApiError(409, 'El ítem ya fue confirmado', 'ENTREGA_YA_CONFIRMADA', { lineaId: p.key });
        // Already applied by an earlier attempt of this actor: success without a second write or stock movement.
        return {
          line, estadoLinea: line.estadoLinea, discrepancy: p.resultado !== RES.RECIBIDO, recibidaPor: rec.recibidaPor, p,
          becameAvailable: line.estadoLinea === L.CONFIRMADA && Number(line.cantidadConfirmada) > 0, alreadyDone: true,
        };
      }

      const q = Number(recItem.cantidadRecibida);
      const discrepancy = p.resultado !== RES.RECIBIDO;
      const newConf = round6((Number(line.cantidadConfirmada) || 0) + p.cantidad);
      // A discrepancy gives back the part that did not arrive: it can be received again.
      const newRec = round6(Math.max(0, (Number(line.cantidadRecibida) || 0) - (q - p.cantidad)));
      const otherPending = (doc.recepciones || []).some((r) => (r.items || []).some((i) => sid(i.lineaId) === p.key && !i.confirmacion
        && !(sid(r.recepcionId) === sid(recepcionId))));
      let estadoLinea;
      if (discrepancy) estadoLinea = L.EN_DISPUTA;
      else if (newConf >= Number(line.cantidadSolicitada)) estadoLinea = L.CONFIRMADA;
      else estadoLinea = otherPending ? L.RECIBIDA : L.RECIBIDA_PARCIAL;

      const buildEvento = (stockOmitido) => buildTimelineEvent({
        tipo: discrepancy ? EV.ENTREGA_DISPUTADA : EV.ENTREGA_CONFIRMADA,
        actorId: actor.userId,
        estadoAnterior: doc.estado,
        estadoNuevo: doc.estado,
        observacion: p.observacion || undefined,
        datos: {
          recepcionId: String(recepcionId), lineaId: p.key, descripcion: line.descripcion, resultado: p.resultado, cantidad: p.cantidad, cantidadRecibida: q,
          ...(p.porManageAll ? { porManageAll: true } : {}),
          ...(stockOmitido ? { stockOmitido } : {}),
        },
      });
      const writeOnce = (moves, stockOmitido) => {
        const marker = moves.length > 0 && line.origenSolicitudRepuestoId ? this._stockMarker(tenantId, id, line.origenSolicitudRepuestoId) : null;
        return this._writeWithStock(tenantId, moves, actor, doc.consecutivo, (session) => this._appendConfirmation({
          id, tenantId, line, p, recepcionId, actor, estadoLinea, newConf, newRec, evento: buildEvento(stockOmitido), session,
        }), marker);
      };
      const moves = stockOn ? this._stockMoves(doc, line, p.cantidad) : [];
      let updated;
      try {
        updated = await writeOnce(moves, null);
      } catch (err) {
        if (!(err instanceof StockItemMissing)) throw err;
        // The stock item was deleted after the reception: confirm WITHOUT stock movement (no marker) and record it (B4).
        updated = await writeOnce([], 'item_no_disponible');
      }
      if (!updated) continue;
      return { line, estadoLinea, discrepancy, recibidaPor: rec.recibidaPor, p, becameAvailable: estadoLinea === L.CONFIRMADA && newConf > 0 };
    }
    throw new ApiError(409, 'La requisición cambió mientras se confirmaba la entrega; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
  }

  _appendConfirmation({ id, tenantId, line, p, recepcionId, actor, estadoLinea, newConf, newRec, evento, session }) {
    return Requisicion.appendEvent(
        { _id: id, tenantId, estado: E.EN_RECEPCION, $and: [lineGuard(line)] },
        [evento],
        {
          set: {
            'lineas.$[lin].estadoLinea': estadoLinea,
            'lineas.$[lin].cantidadConfirmada': newConf,
            'lineas.$[lin].cantidadRecibida': newRec,
          },
          arrayFilters: [{ 'lin.lineaId': oidOf(p.key) }],
          confirmarItem: {
            recepcionId,
            lineaId: p.key,
            confirmacion: {
              por: actor.userId, fecha: new Date(), resultado: p.resultado, cantidad: p.cantidad,
              ...(p.observacion ? { observacion: p.observacion } : {}), ...(p.porManageAll ? { porManageAll: true } : {}),
            },
          },
          ...(session ? { session } : {}),
        },
    );
  }

  /**
   * Ends the requisition when no line is active any more: every line Cancelada (nothing was delivered) -> Cancelada
   * with the aggregated reason; otherwise every active line Confirmada -> Cerrada.
   * Returns `{ doc, tipo: 'closed' | 'cancelled' }` or null.
   */
  async _maybeClose(tenantId, id, actor) {
    const doc = await this._load(tenantId, id);
    if (!RECEIVABLE.includes(doc.estado)) return null;
    const lineas = doc.lineas || [];
    const active = lineas.filter((l) => l.estadoLinea !== L.CANCELADA);
    if (active.length === 0 && lineas.length > 0) return this._cancelAll(tenantId, id, doc, actor);
    if (!active.every((l) => l.estadoLinea === L.CONFIRMADA)) return null;
    try {
      const closed = await transition(tenantId, id, {
        from: doc.estado,
        to: E.CERRADA,
        events: [buildTimelineEvent({
          tipo: EV.CERRADA,
          actorId: actor.userId,
          estadoAnterior: doc.estado,
          estadoNuevo: E.CERRADA,
          observacion: 'Todas las líneas quedaron confirmadas o canceladas',
        })],
      });
      return { doc: typeof closed.toObject === 'function' ? closed.toObject() : closed, tipo: 'closed' };
    } catch (err) {
      if (['TRANSICION_INVALIDA', 'CONFLICTO_CONCURRENTE', 'REQUISICION_NOT_FOUND'].includes(err.code)) return null; // someone else closed it
      throw err;
    }
  }

  /** Every line was cancelled and nothing was confirmed: the requisition ends Cancelada (not "delivered"). */
  async _cancelAll(tenantId, id, doc, actor) {
    const motivos = [...new Set((doc.lineas || []).map((l) => trim(l.cierre?.motivo)).filter(Boolean))];
    const motivo = `Todas las líneas fueron canceladas${motivos.length ? `: ${motivos.join('; ')}` : ''}`.slice(0, 2000);
    const now = new Date();
    try {
      const cancelled = await transition(tenantId, id, {
        from: doc.estado,
        to: E.CANCELADA,
        events: [buildTimelineEvent({
          tipo: EV.CANCELADA,
          actorId: actor.userId,
          estadoAnterior: doc.estado,
          estadoNuevo: E.CANCELADA,
          observacion: motivo,
          fecha: now,
        })],
        set: { canceladaAt: now, canceladaPor: actor.userId, canceladaMotivo: motivo },
      });
      return { doc: typeof cancelled.toObject === 'function' ? cancelled.toObject() : cancelled, tipo: 'cancelled', motivo };
    } catch (err) {
      if (['TRANSICION_INVALIDA', 'CONFLICTO_CONCURRENTE', 'REQUISICION_NOT_FOUND'].includes(err.code)) return null;
      throw err;
    }
  }

  async _afterWrite(tenantId, id, actor, { disponibles = [], extra, minimal } = {}) {
    const ended = await this._maybeClose(tenantId, id, actor);
    const fresh = await this._load(tenantId, id);
    await syncRequisicionSolicitudesSafe(tenantId, fresh, { actorId: actor.userId });
    const ctx = { actorId: actor.userId, actorName: actor.name };
    if (extra) extra(fresh, ctx);
    for (const l of disponibles) {
      if (l.origenSolicitudRepuestoId) {
        notifyRequisicion(tenantId, 'requisicion.delivery.confirmed', fresh, { ...ctx, lineaIds: [sid(l.lineaId)], descripcion: l.descripcion });
      }
    }
    if (ended?.tipo === 'closed') notifyRequisicion(tenantId, 'requisicion.closed', fresh, ctx);
    if (ended?.tipo === 'cancelled') notifyRequisicion(tenantId, 'requisicion.cancelled', fresh, { ...ctx, reason: ended.motivo });
    if (minimal) return minimal(fresh);
    return toPublicPopulated(fresh);
  }

  /**
   * The response is the full requisition only for an actor who may read requisitions (`canRead`) or manage them all;
   * anyone else (e.g. the responsible of a solicitud with no requisiciones:read) gets a minimal payload.
   * @param {{ userId: string, name?: string, canManageAll?: boolean, canRead?: boolean }} actor
   * @param {{ items: {lineaId: string, resultado: string, cantidad?: number, observacion?: string}[] }} data
   */
  async confirmar(tenantId, id, recepcionId, actor, data, capabilities = null) {
    requireTenant(tenantId);
    await this._assertModule(tenantId, capabilities);
    const doc = await this._load(tenantId, id);
    const rec = (doc.recepciones || []).find((r) => sid(r.recepcionId) === sid(recepcionId));
    if (!rec) {
      this._assertEstado(doc, [E.EN_RECEPCION]);
      throw new ApiError(404, 'Recepción no encontrada', 'RECEPCION_NOT_FOUND', { recepcionId });
    }
    const responsible = await this._responsibleByLine(tenantId, doc);
    // Validation (and the idempotency check) run BEFORE the state check: the retry of the confirmation that closed the
    // requisition succeeds, while a Cerrada / Cancelada requisition still rejects NEW confirmations (A5).
    const planned = this._validateConfirmItems(doc, rec, data.items || [], actor, responsible);
    if (doc.estado !== E.EN_RECEPCION && !(planned.length > 0 && planned.every((x) => x.done))) this._assertEstado(doc, [E.EN_RECEPCION]);
    const stockOn = await isCapabilityOn(tenantId, 'usesInventoryAdvanced', capabilities);

    const results = [];
    for (const p of planned) results.push(await this._confirmOne(tenantId, id, recepcionId, p, actor, stockOn));

    const minimal = actor.canRead || actor.canManageAll ? undefined : (fresh) => ({
      _id: fresh._id,
      consecutivo: fresh.consecutivo,
      estado: fresh.estado,
      items: results.map((r) => ({ lineaId: sid(r.line.lineaId), resultado: r.p.resultado, cantidad: r.p.cantidad })),
    });
    return this._afterWrite(tenantId, id, actor, {
      minimal,
      // An idempotent retry (alreadyDone) never re-fires notifications (B5).
      disponibles: results.filter((r) => r.becameAvailable && !r.alreadyDone).map((r) => r.line),
      extra: (fresh, ctx) => {
        for (const r of results.filter((x) => x.discrepancy && !x.alreadyDone)) {
          notifyRequisicion(tenantId, 'requisicion.delivery.disputed', fresh, {
            ...ctx, lineaIds: [sid(r.line.lineaId)], descripcion: r.line.descripcion, reason: r.p.observacion, recibidaPor: sid(r.recibidaPor),
          });
        }
      },
    });
  }

  // ------------------------------------------------------------------------------------------ close a line short

  async cerrarLinea(tenantId, id, lineaId, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await this._assertModule(tenantId, capabilities);
    const motivo = trim(data.motivo);
    if (!motivo) throw new ApiError(400, 'El motivo es obligatorio para cerrar la línea', 'MOTIVO_REQUERIDO');
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const doc = await this._load(tenantId, id);
      this._assertEstado(doc, RECEIVABLE);
      const line = (doc.lineas || []).find((l) => sid(l.lineaId) === sid(lineaId));
      if (!line) throw new ApiError(404, 'Línea no encontrada', 'LINEA_NOT_FOUND', { lineaId });
      if (![...ACTIVE_LINE].includes(line.estadoLinea || L.PENDIENTE)) {
        throw new ApiError(409, `La línea está ${line.estadoLinea} y no se puede cerrar`, 'LINEA_NO_CERRABLE', { lineaId, estadoLinea: line.estadoLinea });
      }
      const pending = (doc.recepciones || []).some((r) => (r.items || []).some((i) => sid(i.lineaId) === sid(lineaId) && !i.confirmacion));
      if (pending) throw new ApiError(409, 'La línea tiene ítems recibidos sin confirmar', 'CONFIRMACIONES_PENDIENTES', { lineaId });

      const conf = Number(line.cantidadConfirmada) || 0;
      const available = conf > 0;
      const estadoLinea = available ? L.CONFIRMADA : L.CANCELADA;
      const set = {
        'lineas.$[lin].estadoLinea': estadoLinea,
        'lineas.$[lin].cierre': { motivo, por: actor.userId, fecha: new Date() },
      };
      if (!available) {
        set.montoEstimado = computeMontoEstimado((doc.lineas || []).map((l) => (sid(l.lineaId) === sid(lineaId) ? { ...l, estadoLinea } : l)));
      }
      const updated = await Requisicion.appendEvent(
        { _id: id, tenantId, estado: { $in: RECEIVABLE }, $and: [lineGuard(line)] },
        [buildTimelineEvent({
          tipo: available ? EV.LINEA_CERRADA : EV.LINEA_CANCELADA,
          actorId: actor.userId,
          estadoAnterior: doc.estado,
          estadoNuevo: doc.estado,
          observacion: motivo,
          datos: { lineaId: sid(lineaId), descripcion: line.descripcion, cantidadSolicitada: line.cantidadSolicitada, cantidadConfirmada: conf },
        })],
        { set, arrayFilters: [{ 'lin.lineaId': oidOf(lineaId) }] },
      );
      if (!updated) continue;
      return this._afterWrite(tenantId, id, actor, {
        disponibles: available ? [line] : [],
        extra: (fresh, ctx) => notifyRequisicion(tenantId, 'requisicion.line.closed', fresh, {
          ...ctx, lineaIds: [sid(lineaId)], descripcion: line.descripcion, reason: motivo,
        }),
      });
    }
    throw new ApiError(409, 'La requisición cambió mientras se cerraba la línea; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
  }
}

export const requisicionRecepcionService = new RequisicionRecepcionService();
