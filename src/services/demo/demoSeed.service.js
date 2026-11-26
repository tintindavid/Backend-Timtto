import { Tenant } from '../../models/tenant.model.js';
import { User } from '../../models/user.model.js';
import { Counter } from '../../models/counter.model.js';
import { TipoRequisicion } from '../../models/tipoRequisicion.model.js';
import { Area } from '../../models/area.model.js';
import { Requisicion } from '../../models/requisicion.model.js';
import { logger } from '../../config/logger.config.js';
import { requireTenant } from '../../utils/tenant.util.js';
import { ALL_CAPABILITIES_ENABLED } from '../../config/tenantCapabilities.config.js';
import { DEFAULT_AREAS, DEFAULT_TIPOS_REQUISICION } from '../../constants/requisicion.constants.js';
import { seedRequisicionDefaults } from '../requisicionSeed.service.js';
import { getDemoConfig } from './demoContext.service.js';
import { withDemoLock, getDemoUsage } from './demoLimits.service.js';
import { loadDemoCatalog } from './demoCatalog.js';
import { buildDemoDataset } from './scenario/index.js';

const CHUNK = 25;
// Seeding hundreds of records against a remote database takes far longer than a regular quota lock.
const SEED_LOCK = { ttlMs: 5 * 60_000, attempts: 0 };
// Quota locks taken while inserting: wait for an in-flight creation, then hold them for the whole insert.
const SEED_LOCK_HELD = { ttlMs: 5 * 60_000 };

const SAMPLE_REQUISITIONS = [
  {
    titulo: '[DEMO] Insumos para mantenimiento preventivo',
    prioridad: 'Media',
    justificacion: 'Reposición de insumos para las visitas del mes.',
    lineas: [
      { descripcion: 'Alcohol isopropílico (galón)', unidad: 'galón', cantidadSolicitada: 2, precioEstimado: 60000 },
      { descripcion: 'Paños sin pelusa (paquete)', unidad: 'paquete', cantidadSolicitada: 10, precioEstimado: 12000 },
    ],
    enviar: false,
  },
  {
    titulo: '[DEMO] Batería de respaldo para monitor',
    prioridad: 'Alta',
    justificacion: 'Solicitada en la orden correctiva de ejemplo.',
    lineas: [{ descripcion: 'Batería recargable 12 V', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 180000 }],
    enviar: true,
  },
];

/** Creates the module defaults and two sample requisitions through the real service (idempotent by title). */
async function seedRequisiciones(tenantId, admin, now) {
  // Loaded on demand: the requisition service pulls most of the application with it.
  const { requisicionService } = await import('../requisicion.service.js');
  await seedRequisicionDefaults(tenantId, { now });
  const tipo = await TipoRequisicion.findOne({ tenantId, codigo: DEFAULT_TIPOS_REQUISICION[0].codigo }).lean();
  const area = await Area.findOne({ tenantId, codigo: DEFAULT_AREAS[0].codigo }).lean();
  const out = { created: 0, notes: [] };
  if (!tipo || !area) {
    out.notes.push('Sin tipo o área de requisición: no se crearon requisiciones de ejemplo.');
    return out;
  }
  const userId = String(admin._id);
  for (const { enviar, ...sample } of SAMPLE_REQUISITIONS) {
    const exists = await Requisicion.collection.findOne({ tenantId, titulo: sample.titulo }, { projection: { _id: 1 } });
    if (exists) continue;
    const created = await requisicionService.create(tenantId, userId, {
      ...sample,
      tipoRequisicionId: String(tipo._id),
      areaId: String(area._id),
      fechaRequerida: new Date(now.getTime() + 15 * 86400000),
    }, ALL_CAPABILITIES_ENABLED);
    out.created += 1;
    if (!enviar) continue;
    try {
      await requisicionService.enviar(tenantId, String(created._id ?? created.id), { userId, name: admin.fullName, canManageAll: false }, {});
    } catch (err) {
      // Approval needs a second person: with only the demo admin it stays as a draft.
      out.notes.push(`"${sample.titulo}" quedó en borrador: ${err.message}`);
    }
  }
  return out;
}

/** Persistence seam (replaced by the DB-free tests). */
export const seedDeps = {
  loadCatalog: () => loadDemoCatalog(),
  // Native collection query: soft-deleted records count as existing, so a retry never revives them.
  findExistingIds: async (Model, tenantId, ids) => (await Model.collection
    .find({ _id: { $in: ids }, tenantId }, { projection: { _id: 1 } })
    .toArray()).map((d) => String(d._id)),
  insert: (Model, doc) => new Model(doc).save(),
  seedRequisiciones,
  getUsage: (tenantId) => getDemoUsage(tenantId),
};

// Limited resources the sample data adds, by model; providers do not count as clients.
const LIMITED = [
  { resource: 'customers', label: 'clientes', model: 'Customer', counts: (d) => d.kind !== 'provider' },
  { resource: 'equipos', label: 'equipos', model: 'EquipoItem', counts: () => true },
];

/** Throws, before writing anything, when completing the sample data would exceed a demo limit. */
async function assertFitsLimits(tenantId, limits, batches) {
  const usage = await seedDeps.getUsage(tenantId);
  for (const { resource, label, model, counts } of LIMITED) {
    const docs = batches.filter((b) => b.Model.modelName === model).flatMap((b) => b.docs).filter(counts);
    const { Model } = batches.find((b) => b.Model.modelName === model);
    const existing = await seedDeps.findExistingIds(Model, tenantId, docs.map((d) => d._id));
    const missing = docs.length - existing.length;
    if (missing > 0 && usage[resource] + missing > limits[resource]) {
      throw new Error(`Los datos de ejemplo superarían el límite de ${limits[resource]} ${label}: elimina registros y reintenta`);
    }
  }
}

async function insertMissing(tenantId, { Model, docs }) {
  const existing = new Set(await seedDeps.findExistingIds(Model, tenantId, docs.map((d) => d._id)));
  const missing = docs.filter((d) => !existing.has(String(d._id)));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const results = await Promise.allSettled(missing.slice(i, i + CHUNK).map((doc) => seedDeps.insert(Model, doc)));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw new Error(`${Model.modelName}: ${failed.reason.message}`);
  }
  return missing.length;
}

/**
 * Creates (or completes) the sample data of a demo account. Only inserts what is missing: nothing is ever updated.
 * NEVER throws; the outcome is stored in `tenant.demo.seedStatus` so the super admin can retry.
 *
 * @returns {Promise<{ status: 'ready'|'error', created: number, notes?: string[], error?: string }>}
 */
export async function seedDemoTenant(tenantId, { now = new Date() } = {}) {
  let created = 0;
  let isDemo = false;
  try {
    requireTenant(tenantId);
    const demo = await getDemoConfig(tenantId);
    isDemo = Boolean(demo);
    if (!isDemo) return { status: 'error', created, error: 'El tenant no es una cuenta de demostración' };

    const notes = await withDemoLock(tenantId, 'seed', async () => {
      const catalog = seedDeps.loadCatalog();
      const user = await User.findOne({ tenantId, role: 'admin' }).sort({ createdAt: 1 }).lean();
      if (!user) throw new Error('La cuenta no tiene un usuario administrador');
      const admin = { ...user, fullName: user.fullName || `${user.firstName} ${user.lastName}`.trim() };
      const { batches, counters } = buildDemoDataset({ tenantId, admin, catalog, now });

      // The quota locks are held so users cannot add records between the limit check and the inserts.
      await withDemoLock(tenantId, 'customers', () => withDemoLock(tenantId, 'equipos', async () => {
        await assertFitsLimits(tenantId, demo.limits, batches);
        // Consecutive numbers are reserved first, so records created by users after a partial seed never collide.
        for (const { key, seq } of counters) {
          await Counter.updateOne({ tenantId, key }, { $max: { seq } }, { upsert: true });
        }
        for (const batch of batches) created += await insertMissing(tenantId, batch);
      }, SEED_LOCK_HELD), SEED_LOCK_HELD);
      const requisiciones = await seedDeps.seedRequisiciones(tenantId, admin, now);
      created += requisiciones.created;
      return requisiciones.notes;
    }, SEED_LOCK);

    await Tenant.updateOne({ tenantId }, { $set: { 'demo.seedStatus': 'ready' } });
    logger.info('seedDemoTenant: ready', { tenantId, created });
    return { status: 'ready', created, notes };
  } catch (err) {
    logger.error('seedDemoTenant: failed', { tenantId, created, error: err.message });
    // A concurrent run holds the lock: its own outcome is the one to store.
    if (isDemo && err.code !== 'DEMO_BUSY') {
      await Tenant.updateOne({ tenantId }, { $set: { 'demo.seedStatus': 'error' } }).catch(() => {});
    }
    return { status: 'error', created, error: err.message };
  }
}
