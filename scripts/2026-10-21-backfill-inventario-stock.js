/**
 * 2026-10-21-backfill-inventario-stock.js
 *
 * One-shot, idempotent migration (change: inventario-stock):
 *   1. every inventory item without `tipo` gets `tipo: 'repuesto'`; without `activo` gets `activo: true`
 *      (soft-deleted items included, `stockActual` and every other field are untouched);
 *   2. every tenant whose free-text `plan` contains "inventario" (the legacy gate) gets BOTH
 *      `capabilities.usesInventoryBasic` and `capabilities.usesInventoryAdvanced` set to true, preserving the
 *      access it had. Only those two keys are written (dot notation); `tenant.plan` is never modified.
 *
 * A second run matches nothing and changes nothing.
 *
 * Usage:
 *   node scripts/2026-10-21-backfill-inventario-stock.js --dry-run
 *   node scripts/2026-10-21-backfill-inventario-stock.js
 *
 * Run it with ENFORCE_TENANT_CAPABILITIES=warn deployed, then switch to `on` once the migrated tenants are checked.
 * Core exported as `backfillInventarioStock()` (no connect/disconnect) so it is unit-testable.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { InventarioRepuesto } from '../src/models/inventarioRepuesto.model.js';

const TIPO_FILTER = { tipo: { $exists: false } };
const ACTIVO_FILTER = { activo: { $exists: false } };
// Plans that actually grant inventory: the word "inventario" (word boundaries, accent-safe) that is NOT negated
// ("sin inventario", "no incluye inventario", "sin acceso a inventario", ...).
const PLAN_REGEX = /(?<![\p{L}\p{N}_])inventario(?![\p{L}\p{N}_])/iu;
const NEGATION_REGEX = /(?<![\p{L}\p{N}_])(sin|no|excluye|excluido|excluida)(?![\p{L}\p{N}_])[^,;.|/]*(?<![\p{L}\p{N}_])inventario(?![\p{L}\p{N}_])/iu;

export function planGrantsInventory(plan) {
  if (typeof plan !== 'string') return false;
  return PLAN_REGEX.test(plan) && !NEGATION_REGEX.test(plan);
}

// Only tenants with at least one flag false/unset are selected. A flag explicitly set to false cannot be told apart
// from "never touched" (no audit trail), so it is set as well; documented limitation: run once, before superadmins
// curate the flags.
const FLAGS_PENDING = [
  { 'capabilities.usesInventoryBasic': { $ne: true } },
  { 'capabilities.usesInventoryAdvanced': { $ne: true } },
];
const TENANT_PREFILTER = {
  plan: { $regex: 'inventario', $options: 'i' },
  $or: FLAGS_PENDING,
};

async function findTenantIdsToEnable() {
  const candidates = await Tenant.find(TENANT_PREFILTER).select('_id plan').setOptions({ includeDeleted: true }).lean();
  return candidates.filter((t) => planGrantsInventory(t.plan)).map((t) => t._id);
}

export async function backfillInventarioStock({ dryRun = false } = {}) {
  const tenantIds = await findTenantIdsToEnable();
  const tenantsToEnable = tenantIds.length;
  const [itemsWithoutTipo, itemsWithoutActivo] = await Promise.all([
    InventarioRepuesto.countDocuments(TIPO_FILTER).setOptions({ includeDeleted: true }),
    InventarioRepuesto.countDocuments(ACTIVO_FILTER).setOptions({ includeDeleted: true }),
  ]);
  console.log(
    `[backfill-inventario-stock] items sin tipo: ${itemsWithoutTipo}, items sin activo: ${itemsWithoutActivo}, ` +
    `tenants con plan "inventario" a habilitar: ${tenantsToEnable}${dryRun ? ' (dry run)' : ''}`,
  );

  const result = {
    itemsWithoutTipo, itemsWithoutActivo, tenantsToEnable,
    itemsTipoUpdated: 0, itemsActivoUpdated: 0, tenantsUpdated: 0, dryRun,
  };
  if (dryRun) return result;

  if (itemsWithoutTipo > 0) {
    const r = await InventarioRepuesto.updateMany(TIPO_FILTER, { $set: { tipo: 'repuesto' } })
      .setOptions({ includeDeleted: true });
    result.itemsTipoUpdated = r.modifiedCount ?? 0;
  }
  if (itemsWithoutActivo > 0) {
    const r = await InventarioRepuesto.updateMany(ACTIVO_FILTER, { $set: { activo: true } })
      .setOptions({ includeDeleted: true });
    result.itemsActivoUpdated = r.modifiedCount ?? 0;
  }
  if (tenantsToEnable > 0) {
    // Only the matched tenants; flags that are already true are rewritten with the same value (no-op).
    const r = await Tenant.updateMany({ _id: { $in: tenantIds } }, {
      $set: { 'capabilities.usesInventoryBasic': true, 'capabilities.usesInventoryAdvanced': true },
    }).setOptions({ includeDeleted: true });
    result.tenantsUpdated = r.modifiedCount ?? 0;
  }
  console.log(`[backfill-inventario-stock] updated`, result);
  return result;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-inventario-stock] Connected to MongoDB');
  try {
    await backfillInventarioStock({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-inventario-stock] Fatal error:', err);
    process.exit(1);
  });
}
