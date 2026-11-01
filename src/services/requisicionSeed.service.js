import { TipoRequisicion } from '../models/tipoRequisicion.model.js';
import { Area } from '../models/area.model.js';
import { ReglaAprobacion } from '../models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../models/presupuestoArea.model.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { getTenantCurrency } from '../utils/tenantCurrency.util.js';
import {
  DEFAULT_AREAS,
  DEFAULT_PRESUPUESTO,
  DEFAULT_REGLA,
  DEFAULT_TIPOS_REQUISICION,
  REQUISICION_TIMEZONE,
} from '../constants/requisicion.constants.js';

const isDuplicateKey = (err) => Boolean(err && err.code === 11000);

/** Calendar year (YYYY) in the module's time zone. */
function currentYear(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REQUISICION_TIMEZONE, year: 'numeric' }).format(now);
}

/**
 * Seeds the catalog entries of ONE collection (types or areas) by `codigo`, soft-deleted ones included:
 *  - missing -> created with `esSistema: true`;
 *  - present and live but not flagged -> ADOPTED (only `esSistema` is set, nothing else is touched);
 *  - present and soft-deleted -> left alone (an admin removed it on purpose).
 * A duplicate-key error (concurrent seed / manual creation) means "already exists".
 * @returns {Promise<{ created: number, adopted: number, codigos: Set<string> }>} `codigos` = live codes after the seed
 */
async function seedCatalog(Model, tenantId, defaults, buildDoc, dryRun) {
  const existing = await Model.find({ tenantId, codigo: { $in: defaults.map((d) => d.codigo) } })
    .setOptions({ includeDeleted: true })
    .lean();
  const byCodigo = new Map(existing.map((e) => [e.codigo, e]));
  const out = { created: 0, adopted: 0, codigos: new Set(existing.filter((e) => !e.isDeleted).map((e) => e.codigo)) };

  for (const def of defaults) {
    const found = byCodigo.get(def.codigo);
    if (found) {
      if (found.isDeleted || found.esSistema === true) continue;
      out.adopted += 1;
      if (!dryRun) {
        await Model.findOneAndUpdate({ _id: found._id, tenantId }, { $set: { esSistema: true } });
      }
      continue;
    }
    if (dryRun) {
      out.created += 1;
      out.codigos.add(def.codigo);
      continue;
    }
    try {
      await Model.create({ tenantId, ...buildDoc(def), esSistema: true });
      out.created += 1;
      out.codigos.add(def.codigo);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Already created concurrently (same codigo) or the NAME is taken by another live record: either way it is skipped.
      logger.warn('seedRequisicionDefaults: default skipped (duplicate key)', { tenantId, codigo: def.codigo, keyPattern: err.keyPattern });
    }
  }
  return out;
}

/**
 * Idempotent per-tenant seed of the Requisiciones defaults (changes requisiciones-e1-base-aprobacion and
 * requisiciones-datos-por-defecto-tenant). All records it creates (or adopts) carry `esSistema: true`:
 *  - the 8 default types and 7 default areas (no heads), by `codigo`, soft-deleted ones included;
 *  - one rule "Jefe de área" (level 1, from 0, no upper limit) ONLY when the tenant has no rules at all;
 *  - one example yearly budget for the area ADMINISTRACION ONLY when the tenant has no budgets at all.
 * Running it twice changes nothing. `dryRun` writes nothing (not even adoptions) and reports what it would do.
 *
 * @param {string} tenantId
 * @param {{ dryRun?: boolean, now?: Date }} [options]
 * @returns {Promise<{ tipos: number, areas: number, regla: number, presupuesto: number, adoptados: number }>}
 */
export async function seedRequisicionDefaults(tenantId, { dryRun = false, now = new Date() } = {}) {
  requireTenant(tenantId);

  const tipos = await seedCatalog(
    TipoRequisicion, tenantId, DEFAULT_TIPOS_REQUISICION,
    (d) => ({ codigo: d.codigo, nombre: d.nombre, activo: true }), dryRun,
  );
  const areas = await seedCatalog(
    Area, tenantId, DEFAULT_AREAS,
    (d) => ({ codigo: d.codigo, nombre: d.nombre, jefesIds: [], activa: true }), dryRun,
  );

  let regla = 0;
  const anyRule = await ReglaAprobacion.exists({ tenantId }).setOptions({ includeDeleted: true });
  if (!anyRule) {
    if (dryRun) {
      regla = 1;
    } else {
      try {
        await ReglaAprobacion.create({ tenantId, ...DEFAULT_REGLA, activo: true, esSistema: true });
        regla = 1;
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
  }

  let presupuesto = 0;
  const anyBudget = await PresupuestoArea.exists({ tenantId }).setOptions({ includeDeleted: true });
  if (!anyBudget && !areas.codigos.has(DEFAULT_PRESUPUESTO.areaCodigo)) {
    logger.warn('seedRequisicionDefaults: example budget skipped, area missing or deleted', { tenantId, codigo: DEFAULT_PRESUPUESTO.areaCodigo });
  }
  if (!anyBudget && areas.codigos.has(DEFAULT_PRESUPUESTO.areaCodigo)) {
    if (dryRun) {
      presupuesto = 1;
    } else {
      const area = await Area.findOne({ tenantId, codigo: DEFAULT_PRESUPUESTO.areaCodigo }).lean();
      if (area) {
        const moneda = await getTenantCurrency(tenantId);
        try {
          await PresupuestoArea.create({
            tenantId,
            areaId: area._id,
            periodo: currentYear(now),
            monto: DEFAULT_PRESUPUESTO.monto,
            moneda,
            esSistema: true,
          });
          presupuesto = 1;
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          logger.warn('seedRequisicionDefaults: example budget skipped (duplicate key)', { tenantId, codigo: DEFAULT_PRESUPUESTO.areaCodigo });
        }
      } else {
        logger.warn('seedRequisicionDefaults: example budget skipped, area missing or deleted', { tenantId, codigo: DEFAULT_PRESUPUESTO.areaCodigo });
      }
    }
  }

  const result = {
    tipos: tipos.created,
    areas: areas.created,
    regla,
    presupuesto,
    adoptados: tipos.adopted + areas.adopted,
  };
  logger.info('seedRequisicionDefaults', { tenantId, dryRun, ...result });
  return result;
}
