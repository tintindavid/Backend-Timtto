'use strict';

/**
 * Shared invariant for `Report.actividadesRealizadas[]` sub-doc entries
 * (report-actividades-extra, design D1 / spec "Report sub-document
 * integrity for activities"):
 *
 *   - Every entry has exactly one origin set: either `actividadProtocoloId`
 *     (protocol-originated) or `actividadMttoId` (extra) — never both,
 *     never neither.
 *   - An entry with `actividadMttoId` set MUST have `esExtra === true`.
 *
 * Not enforced by Mongoose (the schema allows both fields to coexist or be
 * empty) — every write path MUST call this helper before persisting:
 *   - `dtos/updateReport.dto.js` (Joi `.custom()` on PUT/PATCH /reportes/:id)
 *   - `services/report.service.js#addExtraActividades` builds entries that
 *     satisfy this invariant by construction, but the helper remains the
 *     single source of truth so future write paths can't diverge silently.
 */
function hasValue(v) {
  return v !== undefined && v !== null && v !== '';
}

export function isValidActivityOrigin(entry = {}) {
  const hasProtocolo = hasValue(entry.actividadProtocoloId);
  const hasExtra = hasValue(entry.actividadMttoId);

  if (hasProtocolo && hasExtra) return false;
  if (!hasProtocolo && !hasExtra) return false;
  if (hasExtra && entry.esExtra !== true) return false;

  return true;
}
