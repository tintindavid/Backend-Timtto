'use strict';

import { REQUISICION_TIMEZONE, REQUISICION_TZ_OFFSET, PERIODO_REGEX } from '../constants/requisicion.constants.js';

/** Calendar year of `date` in America/Bogota (the numbering year of a requisition). */
export function getYearInBogota(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: REQUISICION_TIMEZONE, year: 'numeric' }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'year').value);
}

/**
 * Half-open UTC range [from, to) of a budget period expressed in America/Bogota time.
 * `YYYY` -> the whole year, `YYYY-MM` -> that month. Returns null for an invalid period.
 */
export function periodoToRange(periodo) {
  if (typeof periodo !== 'string' || !PERIODO_REGEX.test(periodo)) return null;
  const [y, m] = periodo.split('-');
  const year = Number(y);
  const at = (yy, mm) => new Date(`${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01T00:00:00.000${REQUISICION_TZ_OFFSET}`);
  if (m === undefined) return { from: at(year, 1), to: at(year + 1, 1) };
  const month = Number(m);
  return month === 12 ? { from: at(year, 12), to: at(year + 1, 1) } : { from: at(year, month), to: at(year, month + 1) };
}
