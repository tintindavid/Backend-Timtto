/**
 * requisiciones-recordatorios.mjs
 *
 * Scheduled reminders of the requisitions module (change: requisiciones-e4-oc-recepcion, task 2.4). Meant for the Railway
 * cron (`npm run requisiciones:recordatorios`), once a day. For every tenant with the module active:
 *   (a) deliverables RETURNED to the supplier (`entrega.estado = Devolucion`) whose last return is at least
 *       RECORDATORIO_DEVOLUCION_DIAS days old (default 3) and that were not re-delivered -> notifies the holders of
 *       `requisiciones:manage-deliverables`;
 *   (b) physical receptions pending the requester's confirmation for at least RECORDATORIO_CONFIRMACION_DIAS days
 *       (default 3) -> notifies the responsible of the lines (the requester for free lines).
 *
 * Idempotent: (a) at most one reminder per return cycle (`entrega.ultimoRecordatorio` is older than the last return only
 * until it is claimed; a re-delivery and a new return start a new cycle); (b) at most one reminder per reception (a
 * `RECORDATORIO_ENVIADO` timeline event keyed by the reception). The claim is ONE conditional write, so two concurrent
 * runs cannot both notify. A failure in one tenant or requisition never stops the others (it is counted and logged).
 *
 * SAFE USAGE (npm run requisiciones:recordatorios -- <flags>):
 *   1. `--dry-run` reports how many reminders it WOULD send and writes / notifies nothing. WITHOUT it the script WRITES.
 *   2. `--tenant=<tenantId>` limits the run to one tenant. Every query carries the tenantId.
 *   3. Thresholds: env RECORDATORIO_DEVOLUCION_DIAS and RECORDATORIO_CONFIRMACION_DIAS (default 3).
 *
 *   node scripts/requisiciones-recordatorios.mjs --dry-run
 *   node scripts/requisiciones-recordatorios.mjs
 *
 * Core exported as `ejecutarRecordatorios()` (no connect / disconnect) so the tests exercise what runs in production.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { parseFlagsOrExit } from './lib/parse-flags.js';
import { Tenant } from '../src/models/tenant.model.js';
import { Requisicion, buildTimelineEvent } from '../src/models/requisicion.model.js';
import { notifyRequisicion, flushRequisicionNotifications } from '../src/services/requisicionNotify.service.js';
import {
  ENTREGA_ESTADO,
  RECORDATORIO_DIAS_DEFAULT,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../src/constants/requisicion.constants.js';

const TAG = '[requisiciones-recordatorios]';
const DAY_MS = 86400000;

/** Positive number of days from an environment value, else the default. */
export function diasDesdeEntorno(value, fallback = RECORDATORIO_DIAS_DEFAULT) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const sid = (v) => (v === null || v === undefined ? '' : String(v?._id ?? v));

/** (a) Returned deliverables without a re-delivery. */
async function recordarDevoluciones(tenantId, { dryRun, now, dias, notify }, out) {
  const cutoff = new Date(now.getTime() - dias * DAY_MS);
  const docs = await Requisicion.find({
    tenantId,
    estado: { $in: [E.OC_ENVIADA, E.EN_RECEPCION] },
    'ordenCompra.requiereEntregables': true,
    'ordenCompra.entrega.estado': ENTREGA_ESTADO.DEVOLUCION,
    'ordenCompra.entrega.devueltaAt': { $lte: cutoff },
    // not reminded in this cycle yet: never reminded, or reminded before the last return
    $or: [
      { 'ordenCompra.entrega.ultimoRecordatorio': null },
      { $expr: { $lt: ['$ordenCompra.entrega.ultimoRecordatorio', '$ordenCompra.entrega.devueltaAt'] } },
    ],
  }).select('-timeline').lean();
  for (const doc of docs) {
    try {
      if (dryRun) { out.devoluciones += 1; continue; }
      const entrega = doc.ordenCompra.entrega;
      const claimed = await Requisicion.appendEvent(
        {
          _id: doc._id,
          tenantId,
          estado: doc.estado,
          'ordenCompra.entrega.estado': ENTREGA_ESTADO.DEVOLUCION,
          'ordenCompra.entrega.devueltaAt': entrega.devueltaAt,
          'ordenCompra.entrega.ultimoRecordatorio': entrega.ultimoRecordatorio ?? null,
        },
        buildTimelineEvent({
          tipo: EV.RECORDATORIO_ENVIADO, estadoAnterior: doc.estado, estadoNuevo: doc.estado, fecha: now,
          datos: { tipo: 'devolucion', numero: doc.ordenCompra.numero, dias },
        }),
        { set: { 'ordenCompra.entrega.ultimoRecordatorio': now } },
      );
      if (!claimed) { out.omitidas += 1; continue; }
      out.devoluciones += 1;
      notify(tenantId, 'requisicion.reminder.deliverables', doc, { ocNumero: doc.ordenCompra.numero, reason: entrega.ultimaObservacion });
    } catch (err) {
      out.errores += 1;
      console.error(`${TAG} deliverables reminder failed`, { tenantId, requisicionId: sid(doc._id), err: String(err) });
    }
  }
}

/** (b) Receptions still waiting for the requester's confirmation. */
async function recordarConfirmaciones(tenantId, { dryRun, now, dias, notify }, out) {
  const cutoff = new Date(now.getTime() - dias * DAY_MS);
  const docs = await Requisicion.find({
    tenantId,
    estado: E.EN_RECEPCION,
    recepciones: { $elemMatch: { fecha: { $lte: cutoff }, items: { $elemMatch: { confirmacion: { $exists: false } } } } },
  }).lean();
  for (const doc of docs) {
    const reminded = new Set((doc.timeline || [])
      .filter((e) => e.tipo === EV.RECORDATORIO_ENVIADO && e.datos?.tipo === 'confirmacion')
      .map((e) => String(e.datos.recepcionId)));
    for (const rec of doc.recepciones || []) {
      try {
        const pendientes = (rec.items || []).filter((i) => !i.confirmacion);
        if (new Date(rec.fecha).getTime() > cutoff.getTime() || pendientes.length === 0 || reminded.has(sid(rec.recepcionId))) continue;
        if (dryRun) { out.confirmaciones += 1; continue; }
        const claimed = await Requisicion.appendEvent(
          {
            _id: doc._id,
            tenantId,
            estado: E.EN_RECEPCION,
            recepciones: { $elemMatch: { recepcionId: rec.recepcionId, items: { $elemMatch: { confirmacion: { $exists: false } } } } },
            // one reminder per reception, ever: the event of an earlier run (or a racing one) blocks the claim
            timeline: { $not: { $elemMatch: { tipo: EV.RECORDATORIO_ENVIADO, 'datos.recepcionId': sid(rec.recepcionId) } } },
          },
          buildTimelineEvent({
            tipo: EV.RECORDATORIO_ENVIADO, estadoAnterior: doc.estado, estadoNuevo: doc.estado, fecha: now,
            datos: { tipo: 'confirmacion', recepcionId: sid(rec.recepcionId), dias },
          }),
        );
        if (!claimed) { out.omitidas += 1; continue; }
        out.confirmaciones += 1;
        const lineaIds = pendientes.map((i) => sid(i.lineaId));
        const descripcion = (doc.lineas || []).filter((l) => lineaIds.includes(sid(l.lineaId))).map((l) => l.descripcion).slice(0, 3).join(', ');
        notify(tenantId, 'requisicion.reminder.confirmation', doc, { lineaIds, descripcion });
      } catch (err) {
        out.errores += 1;
        console.error(`${TAG} confirmation reminder failed`, { tenantId, requisicionId: sid(doc._id), err: String(err) });
      }
    }
  }
}

/**
 * @param {{ dryRun?: boolean, tenantId?: string|null, now?: Date, devolucionDias?: number, confirmacionDias?: number, notify?: Function }} [opts]
 * @returns {Promise<{ devoluciones: number, confirmaciones: number, omitidas: number, errores: number, tenants: number, dryRun: boolean }>}
 */
export async function ejecutarRecordatorios({
  dryRun = false,
  tenantId = null,
  now = new Date(),
  devolucionDias = diasDesdeEntorno(process.env.RECORDATORIO_DEVOLUCION_DIAS),
  confirmacionDias = diasDesdeEntorno(process.env.RECORDATORIO_CONFIRMACION_DIAS),
  notify = notifyRequisicion,
} = {}) {
  const filter = { isDeleted: { $ne: true }, status: 'active', 'capabilities.usesRequisiciones': true, ...(tenantId ? { tenantId } : {}) };
  const tenants = await Tenant.find(filter).select('tenantId').lean();
  const out = { devoluciones: 0, confirmaciones: 0, omitidas: 0, errores: 0, tenants: tenants.length, dryRun };
  for (const t of tenants) {
    try {
      await recordarDevoluciones(t.tenantId, { dryRun, now, dias: devolucionDias, notify }, out);
      await recordarConfirmaciones(t.tenantId, { dryRun, now, dias: confirmacionDias, notify }, out);
    } catch (err) {
      out.errores += 1;
      console.error(`${TAG} tenant failed (continuing)`, { tenantId: t.tenantId, err: String(err) });
    }
  }
  console.log(`${TAG} ${dryRun ? '(dry-run) would send' : 'sent'}: devoluciones=${out.devoluciones} confirmaciones=${out.confirmaciones} omitidas=${out.omitidas} errores=${out.errores} tenants=${out.tenants}`);
  return out;
}

async function run() {
  const flags = parseFlagsOrExit({ boolean: ['dry-run'], value: ['tenant'] }, 'node scripts/requisiciones-recordatorios.mjs [--dry-run] [--tenant=<tenantId>]');
  const dryRun = flags['dry-run'] === true;
  await mongoose.connect(env.MONGO_URI);
  console.log(`${TAG} Connected to MongoDB`);
  try {
    await ejecutarRecordatorios({ dryRun, tenantId: flags.tenant || null });
    await flushRequisicionNotifications();
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error(`${TAG} Fatal error:`, err);
    process.exit(1);
  });
}
