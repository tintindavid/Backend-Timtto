/**
 * migrate-ot-legacy-responsable-to-programaciones.js
 *
 * One-shot, idempotent migration —
 * ot-responsables-programacion-trazable (design.md D12).
 *
 * For every non-deleted OT with a legacy `ResponsableId` set AND an empty
 * `programaciones[]` (never programmed via the new flow), pushes a single
 * active entry that snapshots the legacy responsable:
 *   { fechaInicio: OT.FechaCreacion, fechaFin: fechaInicio + 30d,
 *     responsables: [{ userId, snapshotName: nameShort(user) }],
 *     isActive: true, createdBy: null, createdByName: 'migration' }
 *
 * Skips OTs whose `ResponsableId` no longer resolves to a User (logs and
 * continues). Idempotent: an OT with `programaciones.length > 0` (already
 * migrated or already programmed manually) is never touched, whether the
 * script is re-run once or many times.
 *
 * Uses env.MONGO_URI (same var as the app — src/config/env.js).
 *
 * The core loop is exported as `migrateOtLegacyResponsable()` (no
 * connect/disconnect) so it's unit-testable with mocked model statics — see
 * tests/scripts/migrate-ot-legacy-responsable.test.js. The
 * connect/disconnect/exit-code CLI wrapper only runs when this file is
 * invoked directly (`node scripts/...`), not when imported.
 *
 * Usage:
 *   node scripts/migrate-ot-legacy-responsable-to-programaciones.js
 *   npm run migrate:ot-legacy-responsable-to-programaciones --prefix TimttoApp
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { OT } from '../src/models/ot.model.js';
import { User } from '../src/models/user.model.js';
import { nameShort } from '../src/utils/nameShort.util.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function migrateOtLegacyResponsable() {
  const ots = await OT.find({
    isDeleted: false,
    ResponsableId: { $ne: null },
    $or: [{ programaciones: { $exists: false } }, { programaciones: { $size: 0 } }],
  })
    .select('_id tenantId ResponsableId FechaCreacion Consecutivo')
    .lean();

  console.log(`[migrate-ot-legacy-responsable] Found ${ots.length} OT(s) to migrate`);

  let migrated = 0;
  let skippedNotFound = 0;
  let skippedAlreadyMigrated = 0;

  for (const ot of ots) {
    const user = await User.findOne({ _id: ot.ResponsableId, tenantId: ot.tenantId }).lean();
    if (!user) {
      console.log(
        `[migrate-ot-legacy-responsable] skip — OT ${ot._id} (${ot.Consecutivo || ''}) legacy responsable ${ot.ResponsableId} not found`,
      );
      skippedNotFound += 1;
      continue;
    }

    const fechaInicio = ot.FechaCreacion ? new Date(ot.FechaCreacion) : new Date();
    const fechaFin = new Date(fechaInicio.getTime() + THIRTY_DAYS_MS);

    const entry = {
      fechaInicio,
      fechaFin,
      responsables: [{ userId: user._id, snapshotName: nameShort(user) }],
      isActive: true,
      createdBy: null,
      createdByName: 'migration',
      createdAt: new Date(),
    };

    // Re-check `programaciones.length === 0` at write time (idempotency
    // guard) — protects against a concurrent manual programación created
    // between the initial find() and this update().
    const result = await OT.updateOne(
      { _id: ot._id, $or: [{ programaciones: { $exists: false } }, { programaciones: { $size: 0 } }] },
      { $push: { programaciones: entry } },
    );

    if (result.modifiedCount === 0) {
      console.log(`[migrate-ot-legacy-responsable] skip — OT ${ot._id} already has programaciones`);
      skippedAlreadyMigrated += 1;
      continue;
    }

    console.log(`[migrate-ot-legacy-responsable] migrated — OT ${ot._id} (${ot.Consecutivo || ''})`);
    migrated += 1;
  }

  const result = { total: ots.length, migrated, skippedNotFound, skippedAlreadyMigrated };
  console.log(
    `[migrate-ot-legacy-responsable] Done. migrated=${result.migrated} skippedNotFound=${result.skippedNotFound} skippedAlreadyMigrated=${result.skippedAlreadyMigrated} total=${result.total}`,
  );
  return result;
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('[migrate-ot-legacy-responsable] Connected to MongoDB');
  await migrateOtLegacyResponsable();
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[migrate-ot-legacy-responsable] Fatal error:', err);
    process.exit(1);
  });
}
