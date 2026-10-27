/**
 * 2026-10-25-seed-requisiciones-defaults.js
 *
 * Idempotent seed of the Requisiciones defaults (change: requisiciones-e1-base-aprobacion): default request types
 * (GENERAL, REPUESTO, PAPELERIA, SERVICIO), the area GENERAL and a "Jefe de área" approval rule. See
 * seedRequisicionDefaults for the exact skip rules; a second run creates nothing.
 *
 * Usage:
 *   node scripts/2026-10-25-seed-requisiciones-defaults.js --dry-run
 *   node scripts/2026-10-25-seed-requisiciones-defaults.js                 (every tenant with usesRequisiciones = true)
 *   node scripts/2026-10-25-seed-requisiciones-defaults.js --tenant=acme   (one tenant, regardless of the flag)
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { seedRequisicionDefaults } from '../src/services/requisicionSeed.service.js';

export async function seedAllRequisicionDefaults({ dryRun = false, tenantId = null } = {}) {
  const filter = tenantId ? { tenantId } : { 'capabilities.usesRequisiciones': true };
  const tenants = await Tenant.find(filter).select('tenantId').lean();
  const totals = { tenants: tenants.length, tipos: 0, areas: 0, reglas: 0, dryRun };
  for (const t of tenants) {
    const r = await seedRequisicionDefaults(t.tenantId, { dryRun });
    totals.tipos += r.tipos;
    totals.areas += r.area;
    totals.reglas += r.regla;
  }
  console.log('[seed-requisiciones-defaults]', totals);
  return totals;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  await mongoose.connect(env.MONGO_URI);
  try {
    await seedAllRequisicionDefaults({ dryRun, tenantId: tenantArg ? tenantArg.split('=')[1] : null });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[seed-requisiciones-defaults] Fatal error:', err);
    process.exit(1);
  });
}
