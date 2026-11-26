'use strict';

import { toBogotaYm, toBogotaParts } from '../utils/dashboardPeriod.util.js';

/**
 * Pure schedule math of the dashboard (change: dashboard-por-tenant-indicadores, design D4).
 * A scheduled maintenance is a pair (equipment, year-month) whose abbreviated month is in `mesesMtto`;
 * it is completed when `mesesMttoRealizados` has an entry whose `fecha` (Bogota time) falls in that year-month.
 */

export const round1 = (n) => Math.round(n * 10) / 10;

/** Percentage with one decimal; 0 when nothing is scheduled (no division errors). */
export const percentage = (done, scheduled) => (scheduled > 0 ? round1((done / scheduled) * 100) : 0);

const ABBREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Set of scheduled month numbers (1-12) from the abbreviated `mesesMtto` ('ene', 'Feb', 'sept', ...). */
export function scheduledMonths(mesesMtto) {
  const out = new Set();
  for (const raw of Array.isArray(mesesMtto) ? mesesMtto : []) {
    const key = String(raw ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().slice(0, 3);
    const idx = ABBREV.indexOf(key);
    if (idx >= 0) out.add(idx + 1);
  }
  return out;
}

/** Set of 'YYYY-MM' (Bogota) keys in which the equipment has a completed entry. */
export function realizedKeys(mesesMttoRealizados) {
  const out = new Set();
  for (const entry of Array.isArray(mesesMttoRealizados) ? mesesMttoRealizados : []) {
    if (!entry?.fecha) continue;
    const d = new Date(entry.fecha);
    if (Number.isNaN(d.getTime())) continue;
    out.add(toBogotaYm(d));
  }
  return out;
}

/**
 * Schedule figures of a set of equipment over a list of year-months.
 *
 * @param {Array<{ClienteId?: any, mesesMtto?: string[], mesesMttoRealizados?: Array}>} equipos lean equipment
 * @param {Array<{anio:number,mes:number,clave:string}>} months
 * @returns {{ programadas:number, realizadas:number, noProgramadasRealizadas:number,
 *             perMonth: Map<string,{programadas:number,realizadas:number}>,
 *             perCliente: Map<string,{programadas:number,realizadas:number}> }}
 */
export function computeSchedule(equipos, months) {
  const perMonth = new Map(months.map((m) => [m.clave, { programadas: 0, realizadas: 0 }]));
  const perCliente = new Map();
  let programadas = 0;
  let realizadas = 0;
  let noProgramadasRealizadas = 0;

  for (const equipo of equipos) {
    const sched = scheduledMonths(equipo.mesesMtto);
    const done = realizedKeys(equipo.mesesMttoRealizados);
    const clienteKey = String(equipo.ClienteId ?? '');
    let bucket = perCliente.get(clienteKey);
    if (!bucket) { bucket = { programadas: 0, realizadas: 0 }; perCliente.set(clienteKey, bucket); }

    for (const m of months) {
      const isDone = done.has(m.clave);
      if (sched.has(m.mes)) {
        programadas += 1; bucket.programadas += 1; perMonth.get(m.clave).programadas += 1;
        if (isDone) { realizadas += 1; bucket.realizadas += 1; perMonth.get(m.clave).realizadas += 1; }
      } else if (isDone) {
        noProgramadasRealizadas += 1;
      }
    }
  }
  return { programadas, realizadas, noProgramadasRealizadas, perMonth, perCliente };
}

/**
 * Overdue maintenances: scheduled in a month of the SAME year before the period start and never completed.
 * @param {Array} equipos
 * @param {Date} periodStart UTC start of the period
 * @returns {number}
 */
export function countOverdue(equipos, periodStart) {
  const { anio, mes } = toBogotaParts(periodStart);
  let overdue = 0;
  for (const equipo of equipos) {
    const sched = scheduledMonths(equipo.mesesMtto);
    if (sched.size === 0) continue;
    const done = realizedKeys(equipo.mesesMttoRealizados);
    for (let m = 1; m < mes; m += 1) {
      if (sched.has(m) && !done.has(`${anio}-${String(m).padStart(2, '0')}`)) overdue += 1;
    }
  }
  return overdue;
}
