/**
 * reconcile-requisicion-solicitudes.js
 *
 * Idempotent repair (change: requisiciones-e2-solicitudes-recepcion, adversarial finding A6). Finds and fixes, per tenant:
 *  - links to a requisition that is missing / deleted / Rechazada / Cancelada without confirmed goods (stale links),
 *  - solicitudes claimed by a requisition that was never created (crash between the claim and the creation),
 *  - links whose requisition line was removed,
 *  - drifted summaries (`disponibilidad`, `cantidadConfirmada`),
 *  - requisitions flagged `solicitudesSyncPendiente` by a failed sync (log tag REQUISICION_SYNC_FAILED).
 * A link whose stock pair was already posted is kept (consistency with the ledger).
 *
 * SAFE USAGE (npm run reconcile:requisicion-solicitudes -- <flags>):
 *   1. ALWAYS run `--dry-run` first and review the counts (it writes nothing). WITHOUT `--dry-run` the script WRITES.
 *   2. Idempotent: a second run reports 0 changes (only still-young orphans are skipped by the grace period).
 *   3. Tenant scoping: by default it visits every tenant that has linked solicitudes or flagged requisitions; use
 *      `--tenant=<tenantId>` to limit it to one. Every query carries the tenantId.
 *   4. Run it off-peak; run it BEFORE enabling the module in a tenant and again after the first week.
 *
 *   node scripts/reconcile-requisicion-solicitudes.js --dry-run
 *   node scripts/reconcile-requisicion-solicitudes.js --dry-run --tenant=<tenantId>
 *   node scripts/reconcile-requisicion-solicitudes.js --tenant=<tenantId>
 *
 * Core exported as `reconcileRequisicionSolicitudes({ tenantId?, dryRun? })` (no connect/disconnect).
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { Requisicion } from '../src/models/requisicion.model.js';
import { reconcileSolicitudes } from '../src/services/requisicionSolicitudSync.service.js';

const COUNT_KEYS = [
  'solicitudesVinculadas', 'requisicionesRevisadas', 'requisicionesMarcadas', 'reclamadasSinRequisicion', 'omitidasPorGracia',
  'enlacesObsoletos', 'lineasRetiradas', 'actualizadas', 'revinculadas', 'conservadasPorStock', 'marcasLimpiadas',
];

export async function reconcileRequisicionSolicitudes({ tenantId = null, dryRun = false, graceMs } = {}) {
  let tenants;
  if (tenantId) tenants = [tenantId];
  else {
    const linked = await Repuestos.distinct('tenantId', { 'requisicion.requisicionId': { $exists: true } });
    const flagged = await Requisicion.distinct('tenantId', { solicitudesSyncPendiente: true });
    tenants = [...new Set([...linked, ...flagged])].filter(Boolean);
  }
  const totals = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
  const perTenant = [];
  for (const t of tenants) {
    const r = await reconcileSolicitudes(t, { dryRun, ...(graceMs !== undefined ? { graceMs } : {}) });
    perTenant.push(r);
    for (const k of COUNT_KEYS) totals[k] += r[k] || 0;
    console.log(`[reconcile-requisicion-solicitudes] ${t}${dryRun ? ' (dry run)' : ''}`, JSON.stringify(Object.fromEntries(COUNT_KEYS.map((k) => [k, r[k]]))));
  }
  console.log('[reconcile-requisicion-solicitudes] total', JSON.stringify({ tenants: tenants.length, dryRun, ...totals }));
  return { dryRun, tenants: tenants.length, totals, perTenant };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const arg = process.argv.find((a) => a.startsWith('--tenant='));
  await mongoose.connect(env.MONGO_URI);
  try {
    await reconcileRequisicionSolicitudes({ tenantId: arg ? arg.slice('--tenant='.length) : null, dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[reconcile-requisicion-solicitudes] Fatal error:', err);
    process.exit(1);
  });
}
