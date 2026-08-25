'use strict';

/**
 * One-shot: seeds `estadoOperativoHistory[]` for every pre-existing
 * `EquipoItem` that doesn't have one yet (2026-08-22).
 *
 * Context: `equipo-estado-operativo-editable-y-cronograma-excel` adds an
 * append-only history array to `EquipoItem.EstadoOperativo`. Without this
 * backfill, the HV timeline for pre-existing equipos would show no state
 * history until the first post-deploy change — looks like a bug even
 * though it isn't (design.md D7, Migration Plan step 5).
 *
 * Each seeded entry: `{ from: null, to: equipo.EstadoOperativo || 'Operativo',
 * source: 'migration', changedBy: null, changedByName: 'Migración', at:
 * equipo.createdAt }`.
 *
 * Any stored `EstadoOperativo` value outside the shared enum is normalized
 * to `'Operativo'` (both on the document and the seeded entry) and every
 * normalization is recorded to `backfill-estado-operativo-normalization.csv`
 * (written to the current working directory) for manual review.
 *
 * Idempotent: only equipos whose `estadoOperativoHistory` is empty/missing
 * are matched — a second run finds no candidates and is a full no-op.
 *
 * Run: `node src/scripts/2026-08-22-backfill-estado-operativo-history.js`
 *   or `npm run db:backfill-estado-operativo-history --prefix TimttoApp`
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { EstadoOperativoValues, EstadoOperativoDefault } from '../constants/estadoOperativo.js';

const CANDIDATE_FILTER = {
  $or: [
    { estadoOperativoHistory: { $exists: false } },
    { estadoOperativoHistory: { $size: 0 } },
  ],
};

const CSV_PATH = path.join(process.cwd(), 'backfill-estado-operativo-normalization.csv');

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const uri = env.MONGO_URI || env.DATABASE_URL;
  if (!uri) {
    throw new Error('MONGO_URI/DATABASE_URL not set');
  }
  await mongoose.connect(uri);
  console.log('Connected. Backfilling estadoOperativoHistory...');

  // `EquipoItem`'s pre(/^find/) hook already excludes isDeleted:true, so
  // countDocuments({}) and find(CANDIDATE_FILTER) below only ever see active
  // equipos — consistent with every other read in the codebase.
  const totalEquipos = await EquipoItem.countDocuments({});
  const candidates = await EquipoItem.find(CANDIDATE_FILTER).lean();

  console.log(`Total equipos activos: ${totalEquipos}`);
  console.log(`Candidatos sin historial: ${candidates.length}`);

  const normalizationRows = [];
  let seeded = 0;
  let normalized = 0;

  for (const equipo of candidates) {
    const storedValue = equipo.EstadoOperativo;
    const isValid = EstadoOperativoValues.includes(storedValue);
    const effectiveValue = isValid ? storedValue : EstadoOperativoDefault;

    if (!isValid) {
      normalized += 1;
      normalizationRows.push({
        tenantId: equipo.tenantId,
        equipoId: String(equipo._id),
        storedValue: storedValue ?? '',
        normalizedTo: effectiveValue,
      });
    }

    const entry = {
      from: null,
      to: effectiveValue,
      motivo: null,
      changedBy: null,
      changedByName: 'Migración',
      source: 'migration',
      reportId: null,
      at: equipo.createdAt || new Date(),
    };

    await EquipoItem.updateOne(
      { _id: equipo._id },
      {
        $push: { estadoOperativoHistory: entry },
        $set: { EstadoOperativo: effectiveValue },
      },
    );
    seeded += 1;
  }

  const skippedAlreadySeeded = totalEquipos - candidates.length;

  if (normalizationRows.length > 0) {
    const header = 'tenantId,equipoId,storedValue,normalizedTo';
    const lines = normalizationRows.map((r) => [r.tenantId, r.equipoId, r.storedValue, r.normalizedTo].map(csvEscape).join(','));
    fs.writeFileSync(CSV_PATH, [header, ...lines].join('\n') + '\n', 'utf8');
    console.log(`Normalizaciones registradas en: ${CSV_PATH}`);
  }

  console.log('--- Resumen ---');
  console.log(`Scanned: ${totalEquipos}`);
  console.log(`Seeded: ${seeded}`);
  console.log(`Normalized: ${normalized}`);
  console.log(`Skipped (already seeded): ${skippedAlreadySeeded}`);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
