/**
 * 2026-10-20-demo-cronograma-externas.js
 *
 * DEMO DATA, not part of the product (cronograma-actividades-externas, task 13). Seeds one tenant with
 * two providers and five scheduled external activities (chains with a vigente activity) so the unified
 * schedule shows overdue, due-soon and later items from different types and providers.
 *
 * Every document it creates carries `demoSeed: 'cronograma-actividades-externas'`, so `--remove` deletes
 * exactly what it created and nothing else. It writes through the native driver (no schema hooks).
 *
 * Usage (default is a dry run; nothing is written without --apply):
 *   node scripts/2026-10-20-demo-cronograma-externas.js --tenant bmlab
 *   node scripts/2026-10-20-demo-cronograma-externas.js --tenant bmlab --apply
 *   node scripts/2026-10-20-demo-cronograma-externas.js --tenant bmlab --remove
 *
 * Uses env.MONGO_URI (same var as the app). The seeding is refused when the tenant already has seeded
 * documents (run --remove first) or has no equipment with preventive months.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';

export const DEMO_MARKER = 'cronograma-actividades-externas';

const PROVIDERS = [
  { key: 'a', Razonsocial: 'Metrologia Andina SAS', Nit: '900111222', Ciudad: 'Bogota', Departamento: 'Cundinamarca', Email: 'contacto@metrologiaandina.example' },
  { key: 'b', Razonsocial: 'Calibraciones del Norte SAS', Nit: '900333444', Ciudad: 'Barranquilla', Departamento: 'Atlantico', Email: 'ventas@calibracionesnorte.example' },
];

// daysFromToday < 0 is overdue. freq is the recurrence in months. provider is a PROVIDERS key or a free-text name.
export const PLAN = [
  { tipo: 'calibracion', freq: 6, daysFromToday: -12, provider: 'a', consecutivo: 'DEMO-CAL-001' },
  { tipo: 'verificacion', freq: 12, daysFromToday: -45, provider: 'b', consecutivo: 'DEMO-VER-002' },
  { tipo: 'calibracion', freq: 12, daysFromToday: 15, provider: 'b', consecutivo: 'DEMO-CAL-003' },
  { tipo: 'ajuste', freq: 6, daysFromToday: 75, provider: 'a', consecutivo: 'DEMO-AJU-004' },
  { tipo: 'inspeccion_tecnica', freq: 12, daysFromToday: 200, provider: 'Laboratorio Externo (sin registrar)', consecutivo: 'DEMO-INS-005' },
];

const utcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDaysUtc = (d, days) => new Date(d.getTime() + days * 86400000);
const addMonthsUtc = (d, months) => {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};

/** Builds the documents to insert without touching the database (exported for tests). */
export function buildDemoPlan({ tenantId, clienteId, clienteIds = [], equipoIds, adminUserId, now = new Date(), providerIds = {} }) {
  const today = utcMidnight(now);
  const rows = PLAN.slice(0, equipoIds.length).map((item, i) => {
    const fechaProxima = addDaysUtc(today, item.daysFromToday);
    const fecha = addMonthsUtc(fechaProxima, -item.freq);
    const isKey = Object.prototype.hasOwnProperty.call(providerIds, item.provider);
    return {
      equipoId: equipoIds[i],
      chain: {
        tenantId, clienteId: clienteIds[i] ?? clienteId, equipoId: equipoIds[i], tipo: item.tipo,
        frecuenciaMeses: item.freq, esUnica: false, fechaProxima, estado: 'vigente',
      },
      activity: {
        tenantId, clienteId: clienteIds[i] ?? clienteId, equipoId: equipoIds[i], tipo: item.tipo, consecutivoExterno: item.consecutivo,
        fecha, proveedor: isKey ? PROVIDERS.find((p) => p.key === item.provider).Razonsocial : item.provider,
        proveedorId: isKey ? providerIds[item.provider] : null,
        estadoFinal: 'aprobada', esInicioCadena: true, cerradaAt: null, createdByUserId: adminUserId,
      },
    };
  });
  return rows;
}

export async function removeDemo(db, tenantId) {
  const out = {};
  for (const name of ['equipo-actividades-externas', 'equipo-cadenas-actividad', 'customers']) {
    const res = await db.collection(name).deleteMany({ tenantId, demoSeed: DEMO_MARKER });
    out[name] = res.deletedCount;
  }
  return out;
}

export async function seedDemo(db, { tenantId, apply = false, now = new Date() }) {
  const tenant = await db.collection('tenants').findOne({ tenantId });
  if (!tenant) throw new Error(`Tenant '${tenantId}' not found`);

  const existing = await db.collection('equipo-cadenas-actividad').countDocuments({ tenantId, demoSeed: DEMO_MARKER });
  if (existing > 0) throw new Error(`Tenant '${tenantId}' already has demo data (${existing} chains). Run with --remove first.`);

  const equipos = await db.collection('equipo-items')
    .find({ tenantId, isDeleted: { $ne: true }, 'mesesMtto.0': { $exists: true } }, { projection: { ClienteId: 1 } })
    .sort({ _id: 1 }).limit(PLAN.length).toArray();
  if (equipos.length === 0) throw new Error(`Tenant '${tenantId}' has no equipment with preventive months`);

  const admin = await db.collection('users').findOne({ tenantId, role: 'admin', isDeleted: { $ne: true } });
  if (!admin) throw new Error(`Tenant '${tenantId}' has no admin user (createdByUserId is required)`);

  const clienteId = tenant.organizationCustomerId ?? equipos[0].ClienteId;
  const now_ = new Date(now);
  const providerIds = {};
  const providerDocs = PROVIDERS.map((p) => {
    const _id = new mongoose.Types.ObjectId();
    providerIds[p.key] = _id;
    return {
      _id, tenantId, kind: 'provider', Razonsocial: p.Razonsocial, Nit: p.Nit, Ciudad: p.Ciudad,
      Departamento: p.Departamento, Email: p.Email, isDeleted: false, createdAt: now_, updatedAt: now_, demoSeed: DEMO_MARKER,
    };
  });

  const rows = buildDemoPlan({
    // each chain belongs to the client that owns its equipment; the tenant's own client is only the fallback
    tenantId, clienteId, clienteIds: equipos.map((e) => e.ClienteId ?? clienteId),
    equipoIds: equipos.map((e) => e._id), adminUserId: admin._id, now, providerIds,
  });

  const summary = {
    tenantId, apply,
    providers: providerDocs.map((p) => p.Razonsocial),
    items: rows.map((r) => ({
      tipo: r.chain.tipo, fechaProxima: r.chain.fechaProxima.toISOString().slice(0, 10),
      proveedor: r.activity.proveedor, linked: !!r.activity.proveedorId,
    })),
  };
  if (!apply) return summary;

  await db.collection('customers').insertMany(providerDocs);
  for (const row of rows) {
    const activityId = new mongoose.Types.ObjectId();
    const chainId = new mongoose.Types.ObjectId();
    await db.collection('equipo-actividades-externas').insertOne({
      _id: activityId, ...row.activity, cadenaId: chainId, isDeleted: false, deletedAt: null,
      createdAt: now_, updatedAt: now_, demoSeed: DEMO_MARKER,
    });
    await db.collection('equipo-cadenas-actividad').insertOne({
      _id: chainId, ...row.chain, actividadVigenteId: activityId, isDeleted: false, deletedAt: null,
      createdAt: now_, updatedAt: now_, demoSeed: DEMO_MARKER,
    });
  }
  return summary;
}

async function run() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--tenant');
  const tenantId = idx >= 0 ? args[idx + 1] : null;
  if (!tenantId) {
    console.error('Usage: node scripts/2026-10-20-demo-cronograma-externas.js --tenant <tenantId> [--apply | --remove]');
    process.exit(1);
  }
  await mongoose.connect(env.MONGO_URI);
  const db = mongoose.connection.db;
  try {
    if (args.includes('--remove')) {
      console.log('[demo-cronograma] removed', await removeDemo(db, tenantId));
    } else {
      const summary = await seedDemo(db, { tenantId, apply: args.includes('--apply') });
      console.log(`[demo-cronograma] ${summary.apply ? 'created' : 'dry run, nothing written'}`);
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.apply) console.log('Add --apply to write it, and --remove to take it out later.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[demo-cronograma] Fatal error:', err.message);
    process.exit(1);
  });
}
