'use strict';

/**
 * backfill-serie-normalized.js
 *
 * One-shot, idempotent backfill — equipo-duplicate-detection-and-replace
 * (design.md D9, Migration Plan step 3/4).
 *
 * For every `EquipoItem` (including soft-deleted rows, so the field stays
 * coherent even if a row is later restored), recomputes `SerieNormalized`
 * from `Serie` using the same rule as the model's pre('save') hook
 * (normalizeSerial + serialHasDigit -> null when not digit-bearing) and
 * updates the document only when the stored value differs. Batched in
 * groups of 500 via bulkWrite for throughput.
 *
 * After the backfill pass, aggregates the collection to find any tuples
 * (tenantId, ClienteId, ItemId, Marca, SerieNormalized) that would violate
 * the partial unique index defined in the model (equipoitem_dedupe_partial)
 * and writes them to `backfill-duplicates-report.csv` in the working
 * directory for admins to triage.
 *
 * IMPORTANT: this script does NOT create the unique index. The index is
 * applied by a follow-up migration script once the report above is empty
 * (or all remaining conflicts have been explicitly accepted) — see
 * tasks.md 14.3 / design.md Migration Plan step 6.
 *
 * The core logic is exported as `backfillSerieNormalized()` (no
 * connect/disconnect) so it's unit-testable with mocked model statics,
 * matching the convention of
 * scripts/migrate-ot-legacy-responsable-to-programaciones.js. The
 * connect/disconnect/exit-code CLI wrapper only runs when this file is
 * invoked directly.
 *
 * Usage:
 *   node src/scripts/backfill-serie-normalized.js
 *   npm run db:backfill-serie-normalized --prefix TimttoApp
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { normalizeSerial, serialHasDigit } from '../utils/serial.util.js';

const BATCH_SIZE = 500;
const REPORT_FILENAME = 'backfill-duplicates-report.csv';

function computeSerieNormalized(serie) {
  const normalized = normalizeSerial(serie || '');
  return serialHasDigit(normalized) ? normalized : null;
}

async function flushBatch(ops, failures) {
  if (!ops.length) return;
  try {
    await EquipoItem.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // With `ordered: false`, Mongo returns a BulkWriteError summarizing
    // per-op failures at the end of the batch. The successful writes in
    // the same batch DID land. We record duplicates (E11000) so the CSV
    // report still runs; anything else is escalated.
    const writeErrors = err?.writeErrors ?? err?.result?.writeErrors ?? [];
    for (const we of writeErrors) {
      const code = we?.err?.code ?? we?.code;
      if (code === 11000) {
        failures.push(we?.err ?? we);
      } else {
        throw err;
      }
    }
    if (writeErrors.length === 0) throw err;
  }
  ops.length = 0;
}

function writeDuplicatesReport(conflicts, failures, cwd = process.cwd()) {
  const header = 'source,tenantId,ClienteId,ItemId,Marca,SerieNormalized,count,ids';
  // Minimal CSV escaping: wrap every field in quotes, doubling embedded quotes.
  const csvField = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const aggregationRows = conflicts.map((c) => {
    const { tenantId, ClienteId, ItemId, Marca, SerieNormalized } = c._id;
    const ids = (c.ids || []).map(String).join('|');
    return ['aggregation', tenantId, ClienteId, ItemId, Marca, SerieNormalized, c.count, ids].map(csvField).join(',');
  });

  // Rows blocked by the live index during the backfill — their SerieNormalized
  // is still null in the DB (the update never landed), so the aggregation
  // above cannot see them. We extract the tuple from Mongo's E11000 keyValue.
  const blockedRows = (failures || []).map((f) => {
    const kv = f?.keyValue ?? f?.err?.keyValue ?? {};
    return ['index_block', kv.tenantId, kv.ClienteId, kv.ItemId, kv.Marca, kv.SerieNormalized, '', ''].map(csvField).join(',');
  });

  const rows = [...aggregationRows, ...blockedRows];
  const csv = [header, ...rows].join('\n') + (rows.length ? '\n' : '');
  const reportPath = path.join(cwd, REPORT_FILENAME);
  fs.writeFileSync(reportPath, csv, 'utf8');
  return reportPath;
}

export async function backfillSerieNormalized({ cwd = process.cwd() } = {}) {
  let scanned = 0;
  let attempted = 0;
  const ops = [];
  const failures = [];

  // EquipoItem's pre(/^find/) hook scopes every find/cursor query to
  // isDeleted:false — soft-deleted rows are excluded from the partial
  // unique index's partialFilterExpression anyway, so they don't need a
  // coherent SerieNormalized for this backfill's purpose.
  const cursor = EquipoItem.find({}).lean().cursor();

  for await (const doc of cursor) {
    scanned += 1;
    const nextValue = computeSerieNormalized(doc.Serie);
    if (nextValue !== (doc.SerieNormalized ?? null)) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { SerieNormalized: nextValue } } } });
      attempted += 1;
    }
    if (ops.length >= BATCH_SIZE) {
      await flushBatch(ops, failures);
    }
  }
  await flushBatch(ops, failures);

  const updated = attempted - failures.length;
  console.log(`[backfill-serie-normalized] Scanned: ${scanned}`);
  console.log(`[backfill-serie-normalized] Updated (digit-bearing): ${updated}`);
  if (failures.length) {
    console.log(`[backfill-serie-normalized] Blocked by live index (E11000): ${failures.length} — see CSV report`);
  }

  const conflicts = await EquipoItem.aggregate([
    { $match: { SerieNormalized: { $type: 'string' }, isDeleted: false } },
    {
      $group: {
        _id: { tenantId: '$tenantId', ClienteId: '$ClienteId', ItemId: '$ItemId', Marca: '$Marca', SerieNormalized: '$SerieNormalized' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const reportPath = writeDuplicatesReport(conflicts, failures, cwd);

  console.log(`[backfill-serie-normalized] Distinct conflicts: ${conflicts.length}`);
  console.log(`[backfill-serie-normalized] Report written: ${reportPath}`);
  console.log(
    '[backfill-serie-normalized] Next step: review backfill-duplicates-report.csv, dedupe manually, then run scripts/apply-serie-normalized-index.js',
  );

  return { scanned, updated, blocked: failures.length, conflicts: conflicts.length, reportPath };
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-serie-normalized] Connected to MongoDB');
  await backfillSerieNormalized();
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-serie-normalized] Fatal error:', err);
    process.exit(1);
  });
}
