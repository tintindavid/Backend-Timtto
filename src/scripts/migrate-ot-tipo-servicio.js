#!/usr/bin/env node
/**
 * Idempotent migration: OT.TipoServicio "Diagnóstico" -> "Diagnostico".
 *
 * Per design decision D10 the enum values are standardized to ASCII to
 * avoid recurring diacritic-comparison defects. This script can be run
 * any number of times safely — once all documents are updated, the
 * matched count is zero on subsequent runs.
 *
 * Usage:
 *   MONGO_URI=mongodb://... node src/scripts/migrate-ot-tipo-servicio.js [--dry-run]
 *
 * Exit codes:
 *   0  success (or nothing to do)
 *   1  remaining documents still have the legacy value after the update
 *   2  invalid invocation (missing MONGO_URI)
 *   3  unexpected error
 */
import mongoose from 'mongoose';

const LEGACY_VALUE = 'Diagnóstico';
const NEW_VALUE = 'Diagnostico';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    uri: process.env.MONGO_URI || argv.find((a) => a.startsWith('mongodb')) || null,
  };
}

async function main() {
  const { dryRun, uri } = parseArgs(process.argv.slice(2));

  if (!uri) {
    console.error('[migrate-ot-tipo-servicio] MONGO_URI not provided.');
    console.error('Usage: MONGO_URI=mongodb://... node src/scripts/migrate-ot-tipo-servicio.js [--dry-run]');
    process.exit(2);
  }

  console.log(`[migrate-ot-tipo-servicio] connecting (dryRun=${dryRun})...`);
  await mongoose.connect(uri, { autoIndex: false });

  try {
    const db = mongoose.connection.db;
    const ots = db.collection('ots');

    const before = await ots.countDocuments({ TipoServicio: LEGACY_VALUE });
    console.log(`[migrate-ot-tipo-servicio] documents with "${LEGACY_VALUE}" before: ${before}`);

    if (before === 0) {
      console.log('[migrate-ot-tipo-servicio] nothing to do, exiting cleanly.');
      return;
    }

    if (dryRun) {
      console.log('[migrate-ot-tipo-servicio] dry-run: no changes applied.');
      return;
    }

    const result = await ots.updateMany(
      { TipoServicio: LEGACY_VALUE },
      { $set: { TipoServicio: NEW_VALUE } }
    );
    console.log(
      `[migrate-ot-tipo-servicio] matched=${result.matchedCount} modified=${result.modifiedCount}`
    );

    const after = await ots.countDocuments({ TipoServicio: LEGACY_VALUE });
    console.log(`[migrate-ot-tipo-servicio] documents with "${LEGACY_VALUE}" after: ${after}`);

    if (after !== 0) {
      console.error(`[migrate-ot-tipo-servicio] FAILED: ${after} documents still have the legacy value.`);
      process.exitCode = 1;
      return;
    }

    console.log('[migrate-ot-tipo-servicio] success.');
  } catch (err) {
    console.error('[migrate-ot-tipo-servicio] error:', err && err.message ? err.message : err);
    process.exitCode = 3;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore
    }
  }
}

main();
