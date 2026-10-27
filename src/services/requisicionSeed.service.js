import { TipoRequisicion } from '../models/tipoRequisicion.model.js';
import { Area } from '../models/area.model.js';
import { ReglaAprobacion } from '../models/reglaAprobacion.model.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { DEFAULT_AREA, DEFAULT_REGLA, DEFAULT_TIPOS_REQUISICION } from '../constants/requisicion.constants.js';

/**
 * Idempotent per-tenant seed of the Requisiciones defaults (change: requisiciones-e1-base-aprobacion):
 *  - the types GENERAL, REPUESTO, PAPELERIA and SERVICIO (skipped by `codigo`, soft-deleted ones included so a type
 *    an admin removed on purpose is not resurrected);
 *  - the area GENERAL (same rule) with NO heads: the admin assigns them;
 *  - one rule "Jefe de área" (level 1, from 0, no upper limit) ONLY when the tenant has no rules at all.
 * Running it twice changes nothing.
 *
 * @returns {Promise<{ tipos: number, area: number, regla: number }>} number of documents created (or that would be, in dry run)
 */
export async function seedRequisicionDefaults(tenantId, { dryRun = false } = {}) {
  requireTenant(tenantId);
  const result = { tipos: 0, area: 0, regla: 0 };

  for (const tipo of DEFAULT_TIPOS_REQUISICION) {
    const exists = await TipoRequisicion.exists({ tenantId, codigo: tipo.codigo }).setOptions({ includeDeleted: true });
    if (exists) continue;
    result.tipos += 1;
    if (!dryRun) await TipoRequisicion.create({ tenantId, codigo: tipo.codigo, nombre: tipo.nombre, activo: true });
  }

  const areaExists = await Area.exists({ tenantId, codigo: DEFAULT_AREA.codigo }).setOptions({ includeDeleted: true });
  if (!areaExists) {
    result.area = 1;
    if (!dryRun) await Area.create({ tenantId, codigo: DEFAULT_AREA.codigo, nombre: DEFAULT_AREA.nombre, jefesIds: [], activa: true });
  }

  const anyRule = await ReglaAprobacion.exists({ tenantId }).setOptions({ includeDeleted: true });
  if (!anyRule) {
    result.regla = 1;
    if (!dryRun) await ReglaAprobacion.create({ tenantId, ...DEFAULT_REGLA, activo: true });
  }

  logger.info('seedRequisicionDefaults', { tenantId, dryRun, ...result });
  return result;
}
