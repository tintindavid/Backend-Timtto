/**
 * 2026-10-20-report-premium-module-usage.js
 *
 * READ-ONLY report for the rollout of the premium modules (modulos-premium-por-tenant). It changes nothing:
 * for every tenant it prints what the tenant has today in each module and whether the flag is already on, and
 * lists the tenants that would LOSE a screen they use if the module stayed off. The superadmin then turns the
 * modules on with one audited call per tenant (the three-switch panel ships with the frontend, after this step):
 *   PATCH /api/v1/platform/tenants/<_id>/capabilities   { "usesQrs": true, "registersExternal": true }
 * The report prints the `_id` the PATCH needs.
 *
 *   "Servicios de terceros" (registersExternal): external activities and external reports
 *   "QRs y tickets"         (usesQrs):           equipment QRs, service QRs and tickets
 *
 * Usage:
 *   node scripts/2026-10-20-report-premium-module-usage.js
 *
 * Uses env.MONGO_URI. The core is exported as `reportModuleUsage(db)` (no connect/disconnect) so it is unit-testable.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { normalizeCapabilities } from '../src/config/tenantCapabilities.config.js';

const NOT_DELETED = { isDeleted: { $ne: true } };

/** Count per tenantId of the documents of a collection, as a Map. */
async function countByTenant(db, collection, filter = {}) {
  const rows = await db.collection(collection).aggregate([
    { $match: { ...NOT_DELETED, ...filter } },
    { $group: { _id: '$tenantId', n: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((r) => [r._id, r.n]));
}

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<{ rows: object[], needsEnabling: object[] }>}
 */
export async function reportModuleUsage(db) {
  const [tenants, equipmentQrs, serviceQrs, tickets, externalActivities, externalReports] = await Promise.all([
    db.collection('tenants').find({}, { projection: { tenantId: 1, name: 1, capabilities: 1, isDeleted: 1 } }).toArray(),
    countByTenant(db, 'equipment_qrs'),
    countByTenant(db, 'service_qrs'),
    countByTenant(db, 'tickets'),
    countByTenant(db, 'equipo-actividades-externas'),
    countByTenant(db, 'reports', { origen: 'externo' }),
  ]);

  const rows = tenants
    .filter((t) => !t.isDeleted)
    .map((t) => {
      const caps = normalizeCapabilities(t.capabilities);
      const usage = {
        equipmentQrs: equipmentQrs.get(t.tenantId) ?? 0,
        serviceQrs: serviceQrs.get(t.tenantId) ?? 0,
        tickets: tickets.get(t.tenantId) ?? 0,
        externalActivities: externalActivities.get(t.tenantId) ?? 0,
        externalReports: externalReports.get(t.tenantId) ?? 0,
      };
      const usesQrsToday = usage.equipmentQrs + usage.serviceQrs + usage.tickets > 0;
      const usesExternalToday = usage.externalActivities + usage.externalReports > 0;
      return {
        id: String(t._id),
        tenantId: t.tenantId,
        name: t.name,
        usesQrs: caps.usesQrs,
        registersExternal: caps.registersExternal,
        ...usage,
        enable: [
          ...(usesQrsToday && !caps.usesQrs ? ['usesQrs'] : []),
          ...(usesExternalToday && !caps.registersExternal ? ['registersExternal'] : []),
        ],
      };
    })
    .sort((a, b) => String(a.tenantId).localeCompare(String(b.tenantId)));

  return { rows, needsEnabling: rows.filter((r) => r.enable.length > 0) };
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  try {
    const { rows, needsEnabling } = await reportModuleUsage(mongoose.connection.db);
    console.table(rows.map((r) => ({
      tenant: r.tenantId,
      'QRs y tickets (flag)': r.usesQrs,
      'QR equipos': r.equipmentQrs,
      'QR servicio': r.serviceQrs,
      tickets: r.tickets,
      'Terceros (flag)': r.registersExternal,
      'act. externas': r.externalActivities,
      'rep. externos': r.externalReports,
    })));
    if (needsEnabling.length === 0) {
      console.log('[premium-module-usage] No tenant uses a module that is off.');
    } else {
      console.log('[premium-module-usage] Enable these modules BEFORE enforcing (superadmin, one PATCH per tenant):');
      for (const r of needsEnabling) {
        const body = JSON.stringify(Object.fromEntries(r.enable.map((flag) => [flag, true])));
        console.log(`  - ${r.tenantId}: PATCH /api/v1/platform/tenants/${r.id}/capabilities ${body}`);
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('[premium-module-usage] failed:', err);
    process.exit(1);
  });
}
