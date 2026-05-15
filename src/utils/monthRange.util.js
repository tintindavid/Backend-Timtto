'use strict';

export const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const MONTH_LABELS = {
  ene: 'Enero', feb: 'Febrero', mar: 'Marzo', abr: 'Abril',
  may: 'Mayo', jun: 'Junio', jul: 'Julio', ago: 'Agosto',
  sep: 'Septiembre', oct: 'Octubre', nov: 'Noviembre', dic: 'Diciembre',
};

/**
 * Returns the ordered array of month codes from `from` to `to` inclusive.
 * @param {string} from - Start month code (e.g. 'ene')
 * @param {string} to   - End month code (e.g. 'mar')
 * @returns {string[]}  - Ordered array of month codes
 * @throws {Error}      - If codes are invalid or range is inverted
 */
export function monthRange(from, to) {
  const fromIdx = MONTHS.indexOf(from);
  const toIdx   = MONTHS.indexOf(to);

  if (fromIdx === -1) throw new Error(`Invalid month code: "${from}"`);
  if (toIdx   === -1) throw new Error(`Invalid month code: "${to}"`);
  if (fromIdx > toIdx) throw new Error(`mesDesde (${from}) must be before or equal to mesHasta (${to})`);

  return MONTHS.slice(fromIdx, toIdx + 1);
}

/**
 * Returns a human-readable period label for a month range.
 * @param {string} from
 * @param {string} to
 * @param {number} year
 * @returns {string}  e.g. "Enero - Marzo 2025"
 */
export function periodLabel(from, to, year) {
  if (from === to) return `${MONTH_LABELS[from]} ${year}`;
  return `${MONTH_LABELS[from]} - ${MONTH_LABELS[to]} ${year}`;
}
