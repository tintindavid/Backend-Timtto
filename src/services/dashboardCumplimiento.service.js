'use strict';

import { EquipoItem } from '../models/equipoitem.model.js';
import { Report } from '../models/report.model.js';
import { periodoResponse, shiftMonth, monthLabelShort, calendarBounds } from '../utils/dashboardPeriod.util.js';
import { classifyReportForOt } from './informeReport.helpers.js';
import { computeSchedule, countOverdue, percentage, round1 } from './dashboardSchedule.helpers.js';
import { equipoMatch, reportBaseMatch, hasExecution, customerNames, notApplied } from './dashboard.common.js';

/**
 * Schedule compliance and equipment of the period (change: dashboard-por-tenant-indicadores, design D4).
 * Services take the dashboard context (`ctx.tenantId` is the tenant of the request, see dashboardContext.util.js).
 */

const TREND_MONTHS = 6;

async function loadEquipos(ctx) {
  return EquipoItem.find(equipoMatch(ctx)).select('ClienteId mesesMtto mesesMttoRealizados').lean();
}

/**
 * Distinct equipment with a cancelled report created in the CALENDAR months the period touches, like the schedule
 * figures (needs executesServices).
 */
async function countCancelledEquipos(ctx, period) {
  if (!hasExecution(ctx)) return 0;
  const match = await reportBaseMatch(ctx);
  match.estado = 'Cancelado';
  const bounds = calendarBounds(period);
  match.FechaCreacion = { $gte: bounds.inicio, $lt: bounds.fin };
  const rows = await Report.aggregate([{ $match: match }, { $group: { _id: '$Equipo' } }, { $count: 'n' }]);
  return rows[0]?.n || 0;
}

/** Report breakdown by maintenance type, classified like the by-OT report (design D4). */
async function breakdownByTipo(ctx) {
  if (!hasExecution(ctx)) return [];
  const match = await reportBaseMatch(ctx);
  match.FechaCreacion = { $gte: ctx.period.inicio, $lt: ctx.period.fin };
  const rows = await Report.aggregate([
    { $match: match },
    { $group: { _id: { tipo: '$tipoMtto', estado: '$estado' }, n: { $sum: 1 } } },
  ]);
  const byTipo = new Map();
  for (const row of rows) {
    const raw = row._id?.tipo || 'Preventivo';
    const tipo = raw === 'Diagnóstico' ? 'Diagnostico' : raw;
    const bucket = byTipo.get(tipo) || { tipo, programados: 0, cumplidos: 0, cancelados: 0, pendientes: 0 };
    const kind = classifyReportForOt({ estado: row._id?.estado });
    bucket.programados += row.n;
    if (kind === 'Cumplido') bucket.cumplidos += row.n;
    else if (kind === 'Cancelado') bucket.cancelados += row.n;
    else bucket.pendientes += row.n;
    byTipo.set(tipo, bucket);
  }
  return [...byTipo.values()].sort((a, b) => b.programados - a.programados || a.tipo.localeCompare(b.tipo));
}

function trendMonths(ctx) {
  const last = ctx.period.mesesAnio[ctx.period.mesesAnio.length - 1];
  const out = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
    const { anio, mes } = shiftMonth(last.anio, last.mes, -i);
    out.push({ anio, mes, clave: `${anio}-${String(mes).padStart(2, '0')}` });
  }
  return out;
}

export class DashboardCumplimientoService {
  /** GET /dashboard/cumplimiento */
  async cumplimiento(ctx) {
    const equipos = await loadEquipos(ctx);
    const months = ctx.period.mesesAnio;
    const trend = trendMonths(ctx);

    const main = computeSchedule(equipos, months);
    const trendStats = computeSchedule(equipos, trend);

    const names = await customerNames(ctx.tenantId, [...main.perCliente.keys()]);
    const porCliente = [...main.perCliente.entries()]
      .filter(([, v]) => v.programadas > 0 || v.realizadas > 0)
      .map(([clienteId, v]) => ({
        clienteId,
        cliente: names.get(clienteId) || '',
        programadas: v.programadas,
        realizadas: v.realizadas,
        porcentaje: percentage(v.realizadas, v.programadas),
      }))
      .sort((a, b) => b.programadas - a.programadas || a.cliente.localeCompare(b.cliente));

    const porTipo = await breakdownByTipo(ctx);

    const tendencia = trend.map((m) => {
      const v = trendStats.perMonth.get(m.clave);
      return {
        mes: m.clave,
        etiqueta: monthLabelShort(m.anio, m.mes),
        programadas: v.programadas,
        realizadas: v.realizadas,
        porcentaje: percentage(v.realizadas, v.programadas),
      };
    });

    const filtrosNoAplicados = notApplied(ctx, ['tipoMtto', 'tecnicoId']);

    return {
      periodo: periodoResponse(ctx.period),
      programadas: main.programadas,
      realizadas: main.realizadas,
      porcentaje: percentage(main.realizadas, main.programadas),
      noProgramadasRealizadas: main.noProgramadasRealizadas,
      porCliente,
      porTipo,
      tendencia,
      filtrosNoAplicados,
    };
  }

  async _periodFigures(ctx, equipos, period) {
    const stats = computeSchedule(equipos, period.mesesAnio);
    return {
      programados: stats.programadas,
      realizados: stats.realizadas,
      pendientes: Math.max(stats.programadas - stats.realizadas, 0),
      vencidos: countOverdue(equipos, period.inicio),
      cancelados: await countCancelledEquipos(ctx, period),
    };
  }

  /** GET /dashboard/equipos-periodo */
  async equiposPeriodo(ctx) {
    const equipos = await loadEquipos(ctx);
    const actual = await this._periodFigures(ctx, equipos, ctx.period);
    const prev = ctx.period.previo;
    const anterior = await this._periodFigures(ctx, equipos, prev);

    const variation = (a, b) => ({
      absoluta: a - b,
      porcentaje: b === 0 ? null : round1(((a - b) / b) * 100),
    });
    const variacion = {};
    for (const key of Object.keys(actual)) variacion[key] = variation(actual[key], anterior[key]);

    return { periodo: periodoResponse(ctx.period), actual, anterior, variacion, filtrosNoAplicados: notApplied(ctx, ['tipoMtto', 'tecnicoId']) };
  }
}

export const dashboardCumplimientoService = new DashboardCumplimientoService();
