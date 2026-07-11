/**
 * normalize-tenant-ids.js
 *
 * One-off migration — E0 saas-security-baseline.
 *
 * Normalizes tenantId to lowercase in the `tenants` collection and in all
 * referencing collections. After this script, all tenantId values in the DB
 * match the schema `lowercase: true` behaviour introduced in E0.
 *
 * Collections updated: tenants, users, customers, equipoitems, ots, reports,
 * tickets, service_qrs, repuestos, sedes, servicios, sheetworks, hvequipos,
 * repuesto_trazabilidades, cronogramas, items, protocoloactividades, protocolomttos,
 * actividad_mttos, actividad_reportes.
 *
 * Idempotent: records already in lowercase are not modified (modifiedCount = 0).
 *
 * Usage:
 *   MONGO_URI=mongodb://... node scripts/normalize-tenant-ids.js
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[normalize-tenant-ids] MONGO_URI env var is required');
  process.exit(1);
}

// Collections that carry a tenantId field.
const COLLECTIONS = [
  'tenants',
  'users',
  'customers',
  'equipoitems',
  'ots',
  'reports',
  'tickets',
  'service_qrs',
  'repuestos',
  'sedes',
  'servicios',
  'sheetworks',
  'hvequipos',
  'repuesto_trazabilidades',
  'cronogramas',
  'items',
  'protocoloactividades',
  'protocolomttos',
  'actividad_mttos',
  'actividad_reportes',
  'inventario_repuestos',
  'informes',
];

async function normalizeCollection(db, collectionName) {
  const collection = db.collection(collectionName);

  // Find documents where tenantId has uppercase characters.
  const docs = await collection
    .find({ tenantId: { $regex: /[A-Z]/ } }, { projection: { _id: 1, tenantId: 1 } })
    .toArray();

  if (docs.length === 0) {
    console.log(`  ${collectionName}: already normalized (0 docs to update)`);
    return 0;
  }

  let updated = 0;
  for (const doc of docs) {
    const normalized = doc.tenantId.toLowerCase();
    const result = await collection.updateOne(
      { _id: doc._id },
      { $set: { tenantId: normalized } },
    );
    if (result.modifiedCount > 0) updated++;
  }

  console.log(`  ${collectionName}: updated ${updated} of ${docs.length} document(s)`);
  return updated;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('[normalize-tenant-ids] Connected to MongoDB');

  const db = mongoose.connection.db;
  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);

  let totalUpdated = 0;

  for (const col of COLLECTIONS) {
    if (!existingCollections.includes(col)) {
      console.log(`  ${col}: collection not found — skipping`);
      continue;
    }
    const count = await normalizeCollection(db, col);
    totalUpdated += count;
  }

  console.log(`[normalize-tenant-ids] Done. Total documents updated: ${totalUpdated}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[normalize-tenant-ids] Fatal error:', err);
  process.exit(1);
});
