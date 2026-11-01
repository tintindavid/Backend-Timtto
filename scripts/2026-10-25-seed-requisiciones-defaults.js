/**
 * 2026-10-25-seed-requisiciones-defaults.js
 *
 * Idempotent seed of the Requisiciones defaults (changes requisiciones-e1-base-aprobacion and
 * requisiciones-datos-por-defecto-tenant): 8 types, 7 areas (no heads), the "Jefe de área" rule (only when the tenant
 * has none) and an example yearly budget for ADMINISTRACION (only when the tenant has none). Types and areas that
 * already exist with a default code are ADOPTED (flagged esSistema, nothing else changes). Soft-deleted records are
 * never resurrected. A second run creates nothing.
 *
 * Usage:
 *   npm run seed:requisiciones-defaults -- --dry-run                     (writes nothing, not even adoptions)
 *   npm run seed:requisiciones-defaults                                  (every tenant with usesRequisiciones = true)
 *   npm run seed:requisiciones-defaults -- --tenant=acme                 (one tenant, regardless of the flag)
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { seedRequisicionDefaults } from '../src/services/requisicionSeed.service.js';

export async function seedAllRequisicionDefaults({ dryRun = false, tenantId = null } = {}) {
  const filter = tenantId ? { tenantId } : { 'capabilities.usesRequisiciones': true };
  const tenants = await Tenant.find(filter).select('tenantId').lean();
  const totals = { tenants: tenants.length, tipos: 0, areas: 0, reglas: 0, presupuestos: 0, adoptados: 0, dryRun };
  for (const t of tenants) {
    const r = await seedRequisicionDefaults(t.tenantId, { dryRun });
    totals.tipos += r.tipos;
    totals.areas += r.areas;
    totals.reglas += r.regla;
    totals.presupuestos += r.presupuesto;
    totals.adoptados += r.adoptados;
  }
  console.log('[seed-requisiciones-defaults]', totals);
  return totals;
}

/**
 * `--tenant=<id>` scopes the run to one tenant. A malformed flag (`--tenant`, `--tenant=`, `--tenant acme`) throws instead of
 * silently falling back to every tenant with the module.
 */
export function parseTenantArg(argv) {
  const arg = argv.find((a) => a === '--tenant' || a.startsWith('--tenant='));
  if (arg === undefined) return null;
  const value = arg.startsWith('--tenant=') ? arg.slice('--tenant='.length).trim() : '';
  if (!value) throw new Error('--tenant requiere un valor: usa --tenant=<id>');
  return value;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const tenantId = parseTenantArg(process.argv);
  await mongoose.connect(env.MONGO_URI);
  try {
    await seedAllRequisicionDefaults({ dryRun, tenantId });
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
