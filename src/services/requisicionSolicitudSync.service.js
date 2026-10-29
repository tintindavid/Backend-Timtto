import { Repuestos } from '../models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../models/repuestotrazabilidad.model.js';
import { Requisicion } from '../models/requisicion.model.js';
import { InventarioMovimiento } from '../models/inventarioMovimiento.model.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import {
  LINEA_ESTADO,
  REPUESTO_DISPONIBILIDAD as D,
  REQUISICION_ESTADO as E,
} from '../constants/requisicion.constants.js';

/**
 * Single writer of `Repuestos.requisicion` after the link exists (change: requisiciones-e2-solicitudes-recepcion,
 * design decisions 2 and 3). It RECOMPUTES the `disponibilidad` of every solicitud linked to a requisition from the
 * state of the requisition and of its line, writes a `repuestotrazabilidad` entry per change
 * ("Requisición REQ-…: <texto>") and NEVER touches `EstadoSolicitud`.
 *
 * It is idempotent (it only writes what differs), tenant-scoped, and every write is conditional on the solicitud still
 * being linked to THIS requisition, so it can never clobber the link of another requisition. Callers:
 *  - the transition paths (enviar, retirar, reabrir, aprobar (last level), rechazar, cancelar, delete, update);
 *  - the reception epic, right after registering a reception / confirming a delivery / closing a line:
 *      `await syncRequisicionSolicitudes(tenantId, updatedRequisicion, { actorId })`.
 *
 * Truth table (see `computeSolicitudTarget`):
 *   Borrador                                   -> En_Requisicion
 *   Enviada | En_Aprobacion                    -> En_Aprobacion
 *   Aprobada | En_Recepcion | Cerrada, line:
 *       Pendiente | Recibida_Parcial           -> En_Abastecimiento
 *       Recibida (not confirmed)               -> Recibida
 *       Confirmada (cantidadConfirmada > 0)    -> Disponible
 *       En_Disputa                             -> En_Disputa
 *   Rechazada | Cancelada | deleted | line Cancelada -> unlink (the solicitud is selectable again) + trace.
 *       A line with confirmed quantity (cantidadConfirmada > 0) keeps its Disponible link even if the requisition is
 *       cancelled (the goods exist; cancelling closes such lines short first).
 */

/** Marker returned by `computeSolicitudTarget` when the solicitud must be released. */
export const UNLINK = Symbol('unlink');

const ELIGIBLE_ESTADO = Object.freeze(['Solicitado', null]); // `$in` with null also matches a missing field
// A populated origin ({ _id, nombre, ... }, as in the public read shape) is accepted as well as a bare id.
const sid = (v) => (v === null || v === undefined ? '' : String(v._id ?? v));
const plain = (o) => (o && typeof o.toObject === 'function' ? o.toObject() : o);

const TEXT = Object.freeze({
  [D.EN_REQUISICION]: 'incluida en la requisición (borrador)',
  [D.EN_APROBACION]: 'enviada a aprobación',
  [D.EN_ABASTECIMIENTO]: 'aprobada, en abastecimiento',
  [D.RECIBIDA]: 'entrega recibida, pendiente de tu confirmación',
  [D.DISPONIBLE]: 'entrega confirmada, el repuesto está disponible',
  [D.EN_DISPUTA]: 'entrega en disputa',
});

/**
 * Pure: disponibilidad of the solicitud behind `linea` given the requisition state.
 * @returns {{ disponibilidad: string|typeof UNLINK, cantidadConfirmada: number, motivo?: string }}
 */
export function computeSolicitudTarget(requisicion, linea) {
  const confirmada = Number(linea?.cantidadConfirmada) || 0;
  const estadoLinea = linea?.estadoLinea || LINEA_ESTADO.PENDIENTE;

  if (requisicion?.isDeleted) {
    return { disponibilidad: UNLINK, cantidadConfirmada: 0, motivo: 'la requisición fue eliminada; la solicitud quedó libre' };
  }
  if (estadoLinea === LINEA_ESTADO.CANCELADA || (estadoLinea === LINEA_ESTADO.CONFIRMADA && confirmada <= 0)) {
    return { disponibilidad: UNLINK, cantidadConfirmada: 0, motivo: 'la línea fue cancelada; la solicitud quedó libre' };
  }
  switch (requisicion?.estado) {
    case E.BORRADOR:
      return { disponibilidad: D.EN_REQUISICION, cantidadConfirmada: 0 };
    case E.ENVIADA:
    case E.EN_APROBACION:
      return { disponibilidad: D.EN_APROBACION, cantidadConfirmada: 0 };
    case E.RECHAZADA:
      return { disponibilidad: UNLINK, cantidadConfirmada: 0, motivo: 'la requisición fue rechazada; la solicitud quedó libre' };
    case E.CANCELADA:
      if (confirmada > 0) return { disponibilidad: D.DISPONIBLE, cantidadConfirmada: confirmada };
      return { disponibilidad: UNLINK, cantidadConfirmada: 0, motivo: 'la requisición fue cancelada; la solicitud quedó libre' };
    case E.APROBADA:
    case E.EN_RECEPCION:
    case E.CERRADA:
      if (estadoLinea === LINEA_ESTADO.CONFIRMADA) return { disponibilidad: D.DISPONIBLE, cantidadConfirmada: confirmada };
      if (estadoLinea === LINEA_ESTADO.EN_DISPUTA) return { disponibilidad: D.EN_DISPUTA, cantidadConfirmada: confirmada };
      if (estadoLinea === LINEA_ESTADO.RECIBIDA) return { disponibilidad: D.RECIBIDA, cantidadConfirmada: confirmada };
      return { disponibilidad: D.EN_ABASTECIMIENTO, cantidadConfirmada: confirmada };
    default:
      // Unknown / future state: leave the solicitud as it is.
      return null;
  }
}

/** Writes the "Requisición REQ-…: <texto>" entry of a solicitud (never throws). */
export async function traceSolicitud(tenantId, solicitud, consecutivo, texto) {
  const estado = solicitud.EstadoSolicitud || 'Solicitado';
  try {
    await RepuestoTrazabilidad.create({
      tenantId,
      SolicitudRepuestoId: solicitud._id,
      Status: estado,
      EstadoActual: estado,
      EstadoA: estado,
      EstadoAnterior: estado,
      EstadoNuevo: estado,
      FechaHoraCambio: new Date(),
      Comentarios: `Requisición ${consecutivo}: ${texto}`,
    });
  } catch (err) {
    logger.error('requisicionSolicitudSync: trace failed (ignored)', { tenantId, solicitudId: sid(solicitud._id), err: String(err) });
  }
}

/** True when the stock pair (entrada) of a confirmed delivery of `itemId` was posted for the requisition. */
async function hasStockPair(tenantId, requisicionId, itemId) {
  if (!itemId) return false;
  const row = await InventarioMovimiento.findOne({
    tenantId, itemId, tipo: 'entrada', referenciaTipo: 'requisicion', referenciaId: sid(requisicionId),
  }).select('_id').lean();
  return Boolean(row);
}

/**
 * Removes the link of ONE solicitud (conditional on it still pointing at `requisicionId`). A `stockDescontadoPor`
 * marker is cleared together with the link ONLY when no stock pair was posted for it; if a pair exists the link is
 * kept (`kept: true`) so the marker and the ledger stay consistent.
 * @returns {Promise<{ unlinked: boolean, kept: boolean }>}
 */
async function unlinkOne(tenantId, sol, requisicionId, { itemId, dryRun = false } = {}) {
  const unset = { requisicion: 1 };
  if (sol.stockDescontadoPor === 'requisicion') {
    if (await hasStockPair(tenantId, requisicionId, itemId || sol.InventarioItemId)) return { unlinked: false, kept: true };
    unset.stockDescontadoPor = 1;
  }
  if (dryRun) return { unlinked: true, kept: false };
  const r = await Repuestos.updateOne({ _id: sol._id, tenantId, 'requisicion.requisicionId': requisicionId }, { $unset: unset });
  return { unlinked: r.modifiedCount > 0, kept: false };
}

/**
 * Recomputes and writes the `requisicion` summary of every solicitud tied to `requisicion` (by the line origin or by
 * the existing link). Safe to call any number of times.
 *
 * @param {string} tenantId
 * @param {object} requisicion  the (updated) requisition document or plain object: `_id, consecutivo, estado, isDeleted, lineas`
 * @param {{ actorId?: string, motivo?: string, checkOrphans?: boolean, dryRun?: boolean }} [opts]  `dryRun` computes the
 *   result without writing; `motivo` replaces the default unlink text in
 *   the trace; `checkOrphans` forces the lookup of solicitudes linked to the requisition even when no line points at one
 *   (a draft whose spare-part lines were all removed)
 * @returns {Promise<{ linked: string[], updated: string[], unlinked: string[] }>}
 */
export async function syncRequisicionSolicitudes(tenantId, requisicion, opts = {}) {
  const result = { linked: [], updated: [], unlinked: [] };
  const req = plain(requisicion);
  if (!req || !tenantId) return result;
  const lines = (req.lineas || []).filter((l) => l.origenSolicitudRepuestoId);
  // Fast path: a requisition with no spare-part lines never touches Repuestos (and no solicitud can point at it).
  if (lines.length === 0 && !opts.checkOrphans) return result;

  const dryRun = Boolean(opts.dryRun);
  const reqId = req._id;
  const origenIds = lines.map((l) => sid(l.origenSolicitudRepuestoId));
  const solicitudes = await Repuestos.find({
    tenantId,
    $or: [{ _id: { $in: origenIds } }, { 'requisicion.requisicionId': reqId }],
  }).lean();
  const byId = new Map(solicitudes.map((s) => [sid(s._id), s]));
  const handled = new Set();

  for (const linea of lines) {
    const id = sid(linea.origenSolicitudRepuestoId);
    handled.add(id);
    const sol = byId.get(id);
    if (!sol) continue; // deleted solicitud: nothing to sync
    const target = computeSolicitudTarget(req, linea);
    if (!target) continue;
    const linkedHere = sid(sol.requisicion?.requisicionId) === sid(reqId);

    if (target.disponibilidad === UNLINK) {
      if (!linkedHere) continue;
      const r = await unlinkOne(tenantId, sol, reqId, { itemId: linea.inventarioItemId, dryRun });
      if (r.kept) (result.kept ||= []).push(id);
      if (r.unlinked) {
        result.unlinked.push(id);
        if (!dryRun) await traceSolicitud(tenantId, sol, req.consecutivo, opts.motivo || target.motivo);
      }
      continue;
    }

    const summary = {
      requisicionId: reqId,
      lineaId: linea.lineaId,
      consecutivo: req.consecutivo,
      disponibilidad: target.disponibilidad,
      cantidadConfirmada: target.cantidadConfirmada,
    };

    if (!linkedHere) {
      // A reopened requisition re-claims its free solicitudes; one linked elsewhere is never taken over.
      const free = !sol.requisicion?.requisicionId && ELIGIBLE_ESTADO.includes(sol.EstadoSolicitud ?? null);
      if (!free) {
        logger.warn('requisicionSolicitudSync: solicitud not linkable (linked elsewhere or not Solicitado)', { tenantId, solicitudId: id, requisicionId: sid(reqId) });
        continue;
      }
      const r = dryRun ? { modifiedCount: 1 } : await Repuestos.updateOne(
        { _id: sol._id, tenantId, EstadoSolicitud: { $in: ELIGIBLE_ESTADO }, 'requisicion.requisicionId': { $exists: false } },
        { $set: { requisicion: summary } },
      );
      if (r.modifiedCount > 0) {
        result.linked.push(id);
        if (!dryRun) await traceSolicitud(tenantId, sol, req.consecutivo, TEXT[target.disponibilidad]);
      }
      continue;
    }

    const cur = sol.requisicion || {};
    const same = cur.disponibilidad === summary.disponibilidad
      && sid(cur.lineaId) === sid(summary.lineaId)
      && cur.consecutivo === summary.consecutivo
      && (Number(cur.cantidadConfirmada) || 0) === summary.cantidadConfirmada;
    if (same) continue;
    // 3.1: a stale requisition document must never regress a newer summary: the confirmed quantity only grows and a
    // Disponible solicitud never goes back to Recibida / En_Abastecimiento, so the write is guarded on the CURRENT state.
    // En_Disputa (a disputed tranche after a partial confirmation) is the one legitimate move away from Disponible.
    const guard = { _id: sol._id, tenantId, 'requisicion.requisicionId': reqId };
    if (summary.disponibilidad !== D.EN_DISPUTA) {
      guard.$or = [{ 'requisicion.cantidadConfirmada': { $exists: false } }, { 'requisicion.cantidadConfirmada': { $lte: summary.cantidadConfirmada } }];
      if (summary.disponibilidad !== D.DISPONIBLE) guard['requisicion.disponibilidad'] = { $ne: D.DISPONIBLE };
    }
    const r = dryRun ? { modifiedCount: 1 } : await Repuestos.updateOne(
      guard,
      {
        $set: {
          'requisicion.lineaId': summary.lineaId,
          'requisicion.consecutivo': summary.consecutivo,
          'requisicion.disponibilidad': summary.disponibilidad,
          'requisicion.cantidadConfirmada': summary.cantidadConfirmada,
        },
      },
    );
    if (r.modifiedCount > 0) {
      result.updated.push(id);
      if (!dryRun && cur.disponibilidad !== summary.disponibilidad) await traceSolicitud(tenantId, sol, req.consecutivo, TEXT[target.disponibilidad]);
    }
  }

  // Orphans: linked to this requisition but their line is gone (removed from the draft): release them.
  for (const sol of solicitudes) {
    const id = sid(sol._id);
    if (handled.has(id) || sid(sol.requisicion?.requisicionId) !== sid(reqId)) continue;
    const r = await unlinkOne(tenantId, sol, reqId, { dryRun });
    if (r.kept) (result.kept ||= []).push(id);
    if (r.unlinked) {
      result.unlinked.push(id);
      if (!dryRun) await traceSolicitud(tenantId, sol, req.consecutivo, opts.motivo || 'la línea fue retirada de la requisición; la solicitud quedó libre');
    }
  }
  return result;
}

/**
 * Never-throwing wrapper for the transition paths: the transition is already committed when the sync runs and the sync
 * is idempotent, so a failure is logged (with the ids needed to re-run it) instead of failing a committed operation.
 * Resolves with the sync result, or `null` when it failed.
 */
export async function syncRequisicionSolicitudesSafe(tenantId, requisicion, opts = {}) {
  const requisicionId = sid(plain(requisicion)?._id);
  try {
    const out = await syncRequisicionSolicitudes(tenantId, requisicion, opts);
    if (plain(requisicion)?.solicitudesSyncPendiente) await setSyncFlag(tenantId, requisicionId, false);
    return out;
  } catch (err) {
    // Distinct tag: grep it in the logs. The failed requisition is also flagged in the database so that
    // `scripts/reconcile-requisicion-solicitudes.js` finds it even if the logs are gone.
    logger.error(`${SYNC_FAILED_TAG} transition already committed; run scripts/reconcile-requisicion-solicitudes.js`, {
      tag: SYNC_FAILED_TAG, tenantId, requisicionId, err: String(err),
    });
    await setSyncFlag(tenantId, requisicionId, true);
    return null;
  }
}

/** Tag of the log line written when the sync of a committed transition failed. */
export const SYNC_FAILED_TAG = 'REQUISICION_SYNC_FAILED';

/** Best-effort set/clear of the `solicitudesSyncPendiente` marker (never throws, never bumps `updatedAt`). */
async function setSyncFlag(tenantId, requisicionId, pending) {
  if (!tenantId || !requisicionId) return;
  try {
    await Requisicion.updateOne(
      { _id: requisicionId, tenantId },
      pending ? { $set: { solicitudesSyncPendiente: true } } : { $unset: { solicitudesSyncPendiente: 1 } },
      { timestamps: false },
    );
  } catch (err) {
    logger.error(`${SYNC_FAILED_TAG} could not flag the requisition`, { tag: SYNC_FAILED_TAG, tenantId, requisicionId, err: String(err) });
  }
}

/**
 * Releases the solicitudes still linked to a requisition regardless of its lines (used when a requisition is removed
 * and by the creation rollback). Returns the ids released.
 */
export async function releaseSolicitudes(tenantId, requisicionId, texto = 'la requisición fue eliminada; la solicitud quedó libre', consecutivo = '') {
  const linked = await Repuestos.find({ tenantId, 'requisicion.requisicionId': requisicionId }).lean();
  const released = [];
  for (const sol of linked) {
    const r = await Repuestos.updateOne({ _id: sol._id, tenantId, 'requisicion.requisicionId': requisicionId }, { $unset: { requisicion: 1 } });
    if (r.modifiedCount > 0) {
      released.push(sid(sol._id));
      if (consecutivo) await traceSolicitud(tenantId, sol, consecutivo, texto);
    }
  }
  return released;
}

// --------------------------------------------------------------------------------------------- stale links (A6)

/** A link younger than this and pointing at a requisition that does not exist yet may be an in-flight claim. */
export const STALE_GRACE_MS = 5 * 60 * 1000;
const REQ_PROJECTION = Object.freeze({
  estado: 1, isDeleted: 1, consecutivo: 1,
  'lineas.lineaId': 1, 'lineas.origenSolicitudRepuestoId': 1, 'lineas.estadoLinea': 1, 'lineas.cantidadConfirmada': 1, 'lineas.inventarioItemId': 1,
});

/**
 * Pure: why is the link of `sol` stale, or null when it is alive. Stale = the requisition is missing (older than the
 * grace period: it may be an in-flight claim), deleted, Rechazada, or Cancelada without confirmed goods for that line.
 */
export function staleReason(sol, req, graceMs = STALE_GRACE_MS) {
  if (!req) {
    const age = Date.now() - new Date(sol.updatedAt || sol.createdAt || 0).getTime();
    return age >= graceMs ? 'la requisición no existe' : null;
  }
  if (req.isDeleted) return 'la requisición fue eliminada';
  if (req.estado === E.RECHAZADA) return 'la requisición fue rechazada';
  if (req.estado === E.CANCELADA) {
    const id = sid(sol._id);
    const linea = (req.lineas || []).find((l) => sid(l.origenSolicitudRepuestoId) === id);
    if (!linea || computeSolicitudTarget(req, linea)?.disponibilidad === UNLINK) return 'la requisición fue cancelada';
  }
  return null;
}

async function loadRequisiciones(tenantId, ids) {
  if (ids.length === 0) return new Map();
  const docs = await Requisicion.find({ _id: { $in: ids }, tenantId }, REQ_PROJECTION, { includeDeleted: true }).lean();
  return new Map(docs.map((d) => [sid(d._id), d]));
}

/**
 * Lazy self-heal: releases the stale links (see `staleReason`) among `rows` (lean solicitudes of the tenant), leaving a
 * trace "enlace obsoleto liberado". The released rows are mutated in place (`requisicion` removed). Never throws: on
 * an error the links are left as they are (the lock stays, which is the safe side).
 * @returns {Promise<string[]>} ids of the solicitudes released
 */
export async function healStaleLinks(tenantId, rows, { graceMs = STALE_GRACE_MS } = {}) {
  const healed = [];
  try {
    const linked = (rows || []).filter((r) => r?.requisicion?.requisicionId);
    if (!tenantId || linked.length === 0) return healed;
    const reqs = await loadRequisiciones(tenantId, [...new Set(linked.map((r) => sid(r.requisicion.requisicionId)))]);
    for (const row of linked) {
      const reqId = row.requisicion.requisicionId;
      const req = reqs.get(sid(reqId));
      const reason = staleReason(row, req, graceMs);
      if (!reason) continue;
      const linea = (req?.lineas || []).find((l) => sid(l.origenSolicitudRepuestoId) === sid(row._id));
      const r = await unlinkOne(tenantId, row, reqId, { itemId: linea?.inventarioItemId });
      if (!r.unlinked) continue;
      await traceSolicitud(tenantId, row, req?.consecutivo || row.requisicion.consecutivo || '', `enlace obsoleto liberado (${reason})`);
      delete row.requisicion;
      delete row.stockDescontadoPor;
      healed.push(sid(row._id));
    }
  } catch (err) {
    logger.error('requisicionSolicitudSync: stale link heal failed (ignored)', { tenantId, err: String(err) });
  }
  return healed;
}

// ------------------------------------------------------------------------------------------------ reconciliation

/**
 * Finds and repairs, for ONE tenant: stale links, solicitudes claimed by a requisition that never existed (crash between
 * the claim and the creation), links whose line was removed, drifted summaries, and requisitions flagged by a failed
 * sync (`solicitudesSyncPendiente`). Idempotent; `dryRun` only reports.
 * @returns {Promise<object>} counts per case
 */
export async function reconcileSolicitudes(tenantId, { dryRun = false, graceMs = STALE_GRACE_MS } = {}) {
  requireTenant(tenantId);
  const out = {
    tenantId, dryRun, solicitudesVinculadas: 0, requisicionesRevisadas: 0, requisicionesMarcadas: 0,
    reclamadasSinRequisicion: 0, omitidasPorGracia: 0, enlacesObsoletos: 0, lineasRetiradas: 0,
    actualizadas: 0, revinculadas: 0, conservadasPorStock: 0, marcasLimpiadas: 0,
  };
  const linked = await Repuestos.find({ tenantId, 'requisicion.requisicionId': { $exists: true } }).lean();
  out.solicitudesVinculadas = linked.length;
  const flagged = await Requisicion.find({ tenantId, solicitudesSyncPendiente: true }, { _id: 1 }, { includeDeleted: true }).lean();
  out.requisicionesMarcadas = flagged.length;
  const ids = [...new Set([...linked.map((s) => sid(s.requisicion.requisicionId)), ...flagged.map((f) => sid(f._id))])];
  if (ids.length === 0) return out;
  const docs = await Requisicion.find({ _id: { $in: ids }, tenantId }, null, { includeDeleted: true }).lean();
  const byId = new Map(docs.map((d) => [sid(d._id), d]));

  for (const id of ids) {
    // 3.1: re-read the requisition right before deriving, so a confirmation that landed since the bulk load is not undone.
    const fresh = byId.has(id)
      ? (await Requisicion.find({ _id: { $in: [id] }, tenantId }, null, { includeDeleted: true }).lean())[0]
      : null;
    const req = fresh || byId.get(id);
    const mine = linked.filter((s) => sid(s.requisicion.requisicionId) === id);
    if (!req) {
      // Claimed by a requisition that was never created (or physically gone).
      for (const sol of mine) {
        if (staleReason(sol, null, graceMs)) {
          const r = await unlinkOne(tenantId, sol, sol.requisicion.requisicionId, { dryRun });
          if (r.kept) out.conservadasPorStock += 1;
          if (r.unlinked) {
            out.reclamadasSinRequisicion += 1;
            if (!dryRun) await traceSolicitud(tenantId, sol, sol.requisicion.consecutivo || '', 'enlace obsoleto liberado (la requisición no existe)');
          }
        } else out.omitidasPorGracia += 1;
      }
      continue;
    }
    out.requisicionesRevisadas += 1;
    const lineIds = new Set((req.lineas || []).map((l) => sid(l.origenSolicitudRepuestoId)).filter(Boolean));
    const orphanIds = new Set(mine.map((s) => sid(s._id)).filter((sidv) => !lineIds.has(sidv)));
    const res = await syncRequisicionSolicitudes(tenantId, req, { checkOrphans: true, dryRun });
    out.lineasRetiradas += res.unlinked.filter((x) => orphanIds.has(x)).length;
    out.enlacesObsoletos += res.unlinked.filter((x) => !orphanIds.has(x)).length;
    out.actualizadas += res.updated.length;
    out.revinculadas += res.linked.length;
    out.conservadasPorStock += (res.kept || []).length;
    if (req.solicitudesSyncPendiente) {
      if (!dryRun) await setSyncFlag(tenantId, id, false);
      out.marcasLimpiadas += 1;
    }
  }
  return out;
}
