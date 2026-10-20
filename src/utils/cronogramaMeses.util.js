/**
 * Pure helpers for the unified schedule (cronograma-actividades-externas).
 * Months use the same three-letter lower-case format as `EquipoItem.mesesMtto`.
 * Dates are evaluated in UTC, the same way `fechaProxima` is produced (addMonths on an ISO date).
 */

export const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

// `new Date(null)` is 1970, so null and undefined must be rejected before building the date.
function toDate(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Distinct months in which a recurring chain falls due within a year: the month of
 * `fechaProxima` plus every multiple of `frecuenciaMeses`, in calendar order.
 * Frequency 12 gives one month, 6 gives two, 1 gives all twelve. A missing or invalid
 * frequency keeps only the month of `fechaProxima`. An invalid date gives no months.
 *
 * With `anio` the answer is exact for that calendar year: a month is scheduled when it is a whole number of
 * `frecuenciaMeses` away from the month of `fechaProxima` (forwards or backwards, so frequencies that do not
 * divide 12, or exceed it, do not drift) and it is not before the month of `desde` (the first registered
 * activity of the chain: nothing is scheduled before the chain existed). Without `anio` the pattern is
 * year-agnostic (legacy behaviour).
 *
 * @param {Date|string} fechaProxima
 * @param {number} frecuenciaMeses
 * @param {{ anio?: number, desde?: Date|string|null }} [opciones]
 * @returns {string[]}
 */
export function calcularMesesRecurrentes(fechaProxima, frecuenciaMeses, { anio, desde } = {}) {
  const fecha = toDate(fechaProxima);
  if (!isValidDate(fecha)) return [];

  if (Number.isInteger(anio)) {
    const paso = Number.isInteger(frecuenciaMeses) && frecuenciaMeses > 0 ? frecuenciaMeses : null;
    const indiceProxima = fecha.getUTCFullYear() * 12 + fecha.getUTCMonth();
    const inicio = toDate(desde);
    const indiceDesde = isValidDate(inicio) ? inicio.getUTCFullYear() * 12 + inicio.getUTCMonth() : -Infinity;
    const meses = [];
    for (let m = 0; m < 12; m += 1) {
      const objetivo = anio * 12 + m;
      if (objetivo < indiceDesde) continue;
      const diferencia = objetivo - indiceProxima;
      if (paso ? diferencia % paso === 0 : diferencia === 0) meses.push(MESES_ABREV[m]);
    }
    return meses;
  }

  const base = fecha.getUTCMonth();
  const step = Number.isInteger(frecuenciaMeses) && frecuenciaMeses > 0 ? frecuenciaMeses : 12;
  const indexes = new Set();
  for (let offset = 0; offset < 12; offset += step) {
    indexes.add((base + offset) % 12);
  }
  return [...indexes].sort((a, b) => a - b).map((i) => MESES_ABREV[i]);
}

/**
 * Whole days from the current UTC day to `fechaProxima` (negative when overdue) and the
 * overdue flag. A chain due today is not overdue.
 *
 * @param {Date|string} fechaProxima
 * @param {Date} [now]
 * @returns {{ vencida: boolean, diasParaVencer: number|null }}
 */
export function calcularVencimiento(fechaProxima, now = new Date()) {
  const fecha = toDate(fechaProxima);
  if (!isValidDate(fecha)) return { vencida: false, diasParaVencer: null };

  const startOf = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diasParaVencer = Math.round((startOf(fecha) - startOf(now)) / MS_PER_DAY);
  return { vencida: diasParaVencer < 0, diasParaVencer };
}
