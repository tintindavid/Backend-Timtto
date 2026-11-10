import { ApiError } from './apiError.util.js';
import {
  METRICAS_RANGO_DEFAULT_DIAS,
  METRICAS_RANGO_MAX_DIAS,
  REQUISICION_TZ_OFFSET,
} from '../constants/requisicion.constants.js';

/**
 * Pure helpers of the reporting (change: requisiciones-e5-reporteria): statistics, the Bogota date range and the mapping
 * of a MongoDB time-out to the "slow report" error. No database access here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Percentile `p` (0-100) of a list of numbers by linear interpolation; null for an empty list. */
export function percentile(values, p) {
  const xs = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
}

export const median = (values) => percentile(values, 50);

const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

/** `{ n, medianaHoras, p90Horas }` of a list of durations in hours (null values when there is no sample). */
export function summarizeHours(hours) {
  const xs = (hours || []).filter((v) => Number.isFinite(v) && v >= 0);
  return { n: xs.length, medianaHoras: round2(median(xs)), p90Horas: round2(percentile(xs, 90)) };
}

/** Calendar date (YYYY-MM-DD) in America/Bogota (fixed -05:00, no daylight saving) of an instant. */
export function bogotaDateString(date = new Date()) {
  return new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const isRealDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`))
  && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;

const addDays = (s, days) => new Date(Date.parse(`${s}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Resolves the metrics range (inclusive days, America/Bogota). Defaults: `hasta` = today, `desde` = last 90 days. 400 on
 * a malformed date, an inverted range or a window above the maximum (366 days).
 * @returns {{ desde: string, hasta: string, from: Date, to: Date, dias: number }}
 */
export function resolveRange({ desde, hasta } = {}, now = new Date()) {
  const bad = (message, code = 'RANGO_INVALIDO') => new ApiError(400, message, code);
  if ((desde && !isRealDate(desde)) || (hasta && !isRealDate(hasta))) {
    throw bad('Las fechas deben tener formato AAAA-MM-DD y ser válidas');
  }
  const end = hasta || bogotaDateString(now);
  const start = desde || addDays(end, -(METRICAS_RANGO_DEFAULT_DIAS - 1));
  if (start > end) throw bad('La fecha inicial no puede ser posterior a la final');
  const dias = Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS) + 1;
  if (dias > METRICAS_RANGO_MAX_DIAS) {
    throw bad(`El rango no puede superar ${METRICAS_RANGO_MAX_DIAS} días`, 'RANGO_DEMASIADO_AMPLIO');
  }
  return {
    desde: start,
    hasta: end,
    from: new Date(`${start}T00:00:00.000${REQUISICION_TZ_OFFSET}`),
    to: new Date(`${end}T23:59:59.999${REQUISICION_TZ_OFFSET}`),
    dias,
  };
}

/** MongoDB error 50 (MaxTimeMSExpired) -> 503 REPORTE_LENTO; any other error is rethrown untouched. */
export function mapReportError(err) {
  const expired = err?.code === 50 || err?.codeName === 'MaxTimeMSExpired' || /operation exceeded time limit/i.test(String(err?.message || ''));
  if (expired) {
    return new ApiError(503, 'El reporte tardó demasiado; reduce el rango de fechas o los filtros e intenta de nuevo', 'REPORTE_LENTO');
  }
  return err;
}
