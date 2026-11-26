'use strict';

import { Report } from '../models/report.model.js';
import { OT } from '../models/ot.model.js';
import { periodoResponse } from '../utils/dashboardPeriod.util.js';
import { round1 } from './dashboardSchedule.helpers.js';
import { doneInPeriodMatch, hasExecution, unavailable, DAY_MS, oid } from './dashboard.common.js';

/**
 * Execution times (change: dashboard-por-tenant-indicadores, design D6): elapsed days between the creation of the
 * work order and the `fechaProcesado` of its done reports. Median and p90 are computed in memory over at most
 * `TIEMPOS_MAX_REPORTES` reports (`truncado: true` when the period has more).
 */

export const TIEMPOS_MAX_REPORTES = 5000;
// Upper bounds are exclusive except the last finite one: <2, <4, <8, <16, <=30, >30 (on the UNROUNDED elapsed days).
export const HISTOGRAM_BUCKETS = Object.freeze([
  { rango: '0-1', inside: (d) => d < 2 },
  { rango: '2-3', inside: (d) => d < 4 },
  { rango: '4-7', inside: (d) => d < 8 },
  { rango: '8-15', inside: (d) => d < 16 },
  { rango: '16-30', inside: (d) => d <= 30 },
  { rango: '>30', inside: () => true },
]);
const SLOWEST_LIMIT = 10;

/** Histogram bucket of the (unrounded) elapsed days: 1.9 is "0-1", 2.0 is "2-3", 30.0 is "16-30". */
export function bucketOf(days) {
  return HISTOGRAM_BUCKETS.find((b) => b.inside(days)).rango;
}

/** Median of a sorted array (mean of the two middle values when even). */
export function medianOfSorted(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile of a sorted array. */
export function percentileOfSorted(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Loads the execution times of the done reports of the period matched by `match`.
 * `dias` is UNROUNDED (rounded to one decimal only for display).
 * @returns {Promise<{ rows: Array<{otId:string, consecutivo:string, dias:number}>, truncado: boolean }>}
 */
export async function loadExecutionTimes(ctx, match) {
  const reports = await Report.find(match)
    .select('orden fechaProcesado')
    .sort({ fechaProcesado: 1 })
    .limit(TIEMPOS_MAX_REPORTES + 1)
    .lean();
  const truncado = reports.length > TIEMPOS_MAX_REPORTES;
  const used = truncado ? reports.slice(0, TIEMPOS_MAX_REPORTES) : reports;

  const ordenIds = [...new Set(used.map((r) => r.orden).filter(Boolean).map(String))];
  if (ordenIds.length === 0) return { rows: [], truncado };
  const ots = await OT.find({ tenantId: ctx.tenantId, _id: { $in: ordenIds.map((id) => oid(id)) } })
    .select('Consecutivo FechaCreacion')
    .lean();
  const otById = new Map(ots.map((o) => [String(o._id), o]));

  const rows = [];
  for (const report of used) {
    const ot = report.orden ? otById.get(String(report.orden)) : null;
    if (!ot?.FechaCreacion || !report.fechaProcesado) continue;
    const diff = (new Date(report.fechaProcesado).getTime() - new Date(ot.FechaCreacion).getTime()) / DAY_MS;
    if (!Number.isFinite(diff) || diff < 0) continue;
    rows.push({ otId: String(ot._id), consecutivo: ot.Consecutivo || '', dias: diff });
  }
  return { rows, truncado };
}

export class DashboardTiemposService {
  /** GET /dashboard/tiempos */
  async tiempos(ctx) {
    const periodo = periodoResponse(ctx.period);
    if (!hasExecution(ctx)) return { periodo, ...unavailable() };

    const match = await doneInPeriodMatch(ctx, { onlyProcesado: true });
    const { rows, truncado } = await loadExecutionTimes(ctx, match);

    const histograma = HISTOGRAM_BUCKETS.map((b) => ({ rango: b.rango, cantidad: 0 }));
    for (const r of rows) histograma[HISTOGRAM_BUCKETS.findIndex((b) => b.rango === bucketOf(r.dias))].cantidad += 1;

    const sorted = rows.map((r) => r.dias).sort((a, b) => a - b);
    const total = rows.length;
    const promedio = total ? round1(sorted.reduce((s, v) => s + v, 0) / total) : null;

    const byOt = new Map();
    for (const r of rows) {
      const acc = byOt.get(r.otId) || { otId: r.otId, consecutivo: r.consecutivo, suma: 0, reportes: 0 };
      acc.suma += r.dias;
      acc.reportes += 1;
      byOt.set(r.otId, acc);
    }
    const masLentas = [...byOt.values()]
      .map((o) => ({ otId: o.otId, consecutivo: o.consecutivo, promedioDias: round1(o.suma / o.reportes), reportes: o.reportes }))
      .sort((a, b) => b.promedioDias - a.promedioDias || a.consecutivo.localeCompare(b.consecutivo))
      .slice(0, SLOWEST_LIMIT);

    return {
      periodo,
      disponible: true,
      total,
      promedioDias: promedio,
      medianaDias: total ? round1(medianOfSorted(sorted)) : null,
      p90Dias: total ? round1(percentileOfSorted(sorted, 0.9)) : null,
      histograma,
      masLentas,
      truncado,
    };
  }
}

export const dashboardTiemposService = new DashboardTiemposService();
