import { demoId } from '../demoIds.js';
import { ALL_CAPABILITIES_ENABLED } from '../../../config/tenantCapabilities.config.js';
import { buildCatalogo } from './catalogo.js';
import { buildTerceros } from './terceros.js';
import { buildEquipos } from './equipos.js';
import { buildOrdenes } from './ordenes.js';
import { buildHojasVida } from './hojasVida.js';
import { buildInventario } from './inventario.js';
import { buildExternos } from './externos.js';
import { buildQrTickets } from './qrTickets.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Builds every sample document of a demo account. Pure (no database): dates are relative to `now`. `capabilities` decides
 * the content: work orders when it executes services, third-party services when it registers them.
 * Builders run in dependency order and share `ctx.refs`; later ones may still complete documents of earlier ones
 * (e.g. an equipment gets its maintenance history from the work orders) before anything is inserted.
 *
 * @returns {{ batches: Array<{ Model, docs }>, counters: Array<{ key, seq }> }}
 */
export function buildDemoDataset({ tenantId, admin, catalog, now, capabilities = ALL_CAPABILITIES_ENABLED, organizationName }) {
  const sequences = new Map();
  const ctx = {
    tenantId,
    admin,
    catalog,
    now,
    capabilities,
    organizationName,
    refs: {},
    id: (key) => demoId(tenantId, key),
    daysAgo: (days) => new Date(now.getTime() - days * DAY),
    daysAhead: (days) => new Date(now.getTime() + days * DAY),
    next: (key) => {
      const seq = (sequences.get(key) ?? 0) + 1;
      sequences.set(key, seq);
      return seq;
    },
  };
  const batches = [
    buildCatalogo, buildTerceros, buildEquipos, buildOrdenes,
    buildHojasVida, buildInventario, buildExternos, buildQrTickets,
  ].flatMap((build) => build(ctx));
  return { batches, counters: [...sequences].map(([key, seq]) => ({ key, seq })) };
}
