import { equipoItemService } from './equipoitem.service.js';

/**
 * Operative state set by a service done by a third party (reportes-externos-mp-mc): an external report or an
 * external activity. The state of the equipment follows the LAST SERVICE BY DATE, so a service dated before
 * another one that already set the state is kept as history but does not overwrite it.
 *
 * What counts as "a later state": the history entries that describe real events. The initial values written
 * when the equipment was loaded (`from: null`, or source `bulk-upload` / `migration`) carry the day the record was
 * created, not the day of any service, so they never block a service. Entries of external services are stamped
 * with the date of the service. Comparison is by UTC day, so a service dated the same day as the last change applies.
 */

const SEED_SOURCES = ['bulk-upload', 'migration'];

const utcDay = (value) => {
  const d = new Date(value);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Date of the most recent state change that is a real event (not the initial load), or null. */
export function ultimoCambioDeEstado(history) {
  let latest = null;
  for (const entry of history || []) {
    if (!entry || entry.from === null || entry.from === undefined) continue; // initial value
    if (SEED_SOURCES.includes(entry.source)) continue;
    const at = entry.at ? new Date(entry.at) : null;
    if (at && !Number.isNaN(at.getTime()) && (!latest || at > latest)) latest = at;
  }
  return latest;
}

/** True when a service dated `fecha` would be older than the last real state change of the equipment. */
export function esServicioAtrasadoParaEstado(equipo, fecha) {
  const last = ultimoCambioDeEstado(equipo?.estadoOperativoHistory);
  return Boolean(last) && utcDay(fecha) < utcDay(last);
}

/**
 * Applies the operative state of a service to the equipment through the single history writer.
 * @param {object} args
 * @param {object} args.equipo lean equipment with `_id` and `estadoOperativoHistory`
 * @param {string} args.estadoOperativo
 * @param {Date} args.fecha date of the service
 * @param {'report-external'|'actividad-externa'} args.source
 * @param {string|object|null} [args.reportId]
 * @param {object|null} [args.panelUser]
 * @param {string} args.tenantId
 * @returns {Promise<{ applied: boolean }>}
 */
export async function aplicarEstadoDeServicio({ equipo, estadoOperativo, fecha, source, reportId = null, panelUser = null, tenantId }) {
  if (!estadoOperativo) return { applied: false };
  if (esServicioAtrasadoParaEstado(equipo, fecha)) return { applied: false };
  await equipoItemService._appendEstadoOperativoHistory(equipo._id, estadoOperativo, {
    source,
    reportId,
    panelUser,
    tenantId,
    at: fecha,
    // A service that confirms the current state must still leave its dated entry, or an older service loaded
    // afterwards would overwrite it.
    recordSame: true,
  });
  return { applied: true };
}
