'use strict';

import { ApiError } from './apiError.util.js';

/**
 * Period resolution for the dashboard (change: dashboard-por-tenant-indicadores, design D11).
 * All calendar math is America/Bogota, a fixed UTC-5 zone (no daylight saving time).
 */

export const BOGOTA_OFFSET_HOURS = 5; // Bogota local = UTC - 5h
const HOUR_MS = 3600 * 1000;
export const MAX_PERIOD_MONTHS = 24;
export const PERIODOS = Object.freeze(['mes_actual', 'mes_anterior', 'rango', 'anio']);

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const pad2 = (n) => String(n).padStart(2, '0');

/** UTC instant of the first moment (Bogota time) of month `mes` (1-12, may overflow) of `anio`. */
export function monthStartUtc(anio, mes) {
  return new Date(Date.UTC(anio, mes - 1, 1, BOGOTA_OFFSET_HOURS));
}

/** Bogota calendar parts of a UTC instant. */
export function toBogotaParts(date) {
  const d = new Date(new Date(date).getTime() - BOGOTA_OFFSET_HOURS * HOUR_MS);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/** 'YYYY-MM' key (Bogota time) of a UTC instant. */
export function toBogotaYm(date) {
  const { anio, mes } = toBogotaParts(date);
  return `${anio}-${pad2(mes)}`;
}

/** 'YYYY-MM-DD' (Bogota time) of a UTC instant. */
export function toBogotaYmd(date) {
  const { anio, mes, dia } = toBogotaParts(date);
  return `${anio}-${pad2(mes)}-${pad2(dia)}`;
}

export function monthLabelLong(anio, mes) {
  return `${MESES_LARGO[mes - 1]} ${anio}`;
}

export function monthLabelShort(anio, mes) {
  return `${MESES_CORTO[mes - 1]} ${anio}`;
}

/** Adds `delta` months to a (anio, mes) pair. */
export function shiftMonth(anio, mes, delta) {
  const idx = anio * 12 + (mes - 1) + delta;
  return { anio: Math.floor(idx / 12), mes: (idx % 12) + 1 };
}

/** Year-month list ({anio, mes, clave}) of the months overlapping [inicio, fin). */
export function monthsBetween(inicio, fin) {
  const first = toBogotaParts(inicio);
  const last = toBogotaParts(new Date(fin.getTime() - 1));
  const out = [];
  let cur = { anio: first.anio, mes: first.mes };
  const endIdx = last.anio * 12 + last.mes;
  while (cur.anio * 12 + cur.mes <= endIdx) {
    out.push({ anio: cur.anio, mes: cur.mes, clave: `${cur.anio}-${pad2(cur.mes)}` });
    cur = shiftMonth(cur.anio, cur.mes, 1);
  }
  return out;
}

function validationError(message, details) {
  return new ApiError(400, message, 'VALIDATION_ERROR', details);
}

/** Parses a strict YYYY-MM-DD calendar date; returns {anio, mes, dia} or throws VALIDATION_ERROR. */
function parseYmd(value, field) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) throw validationError(`${field} debe tener formato YYYY-MM-DD`, { [field]: 'Formato inválido' });
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const check = new Date(Date.UTC(anio, mes - 1, dia));
  if (check.getUTCFullYear() !== anio || check.getUTCMonth() !== mes - 1 || check.getUTCDate() !== dia) {
    throw validationError(`${field} no es una fecha válida`, { [field]: 'Fecha inválida' });
  }
  return { anio, mes, dia };
}

const dayStartUtc = ({ anio, mes, dia }) => new Date(Date.UTC(anio, mes - 1, dia, BOGOTA_OFFSET_HOURS));

function buildPeriod(inicio, fin, etiqueta) {
  return { inicio, fin, etiqueta, mesesAnio: monthsBetween(inicio, fin) };
}

/**
 * Previous period. The schedule (cronograma) works in whole calendar months, so a range that is not made of whole
 * months is rounded to the months it touches; the previous period is the SAME NUMBER of calendar months immediately
 * before the first month touched (never overlapping the current one). For month-aligned periods it is the usual
 * "previous month / previous year".
 */
function previousOf(current) {
  const n = current.mesesAnio.length;
  const first = current.mesesAnio[0];
  const start = shiftMonth(first.anio, first.mes, -n);
  const inicio = monthStartUtc(start.anio, start.mes);
  const fin = monthStartUtc(first.anio, first.mes);
  let etiqueta;
  if (n === 1) etiqueta = monthLabelLong(start.anio, start.mes);
  else if (n === 12 && start.mes === 1) etiqueta = String(start.anio);
  else etiqueta = `${toBogotaYmd(inicio)} a ${toBogotaYmd(new Date(fin.getTime() - 1))}`;
  return buildPeriod(inicio, fin, etiqueta);
}

/** Calendar-month bounds [inicio, fin) of the months a period touches (what the schedule figures measure). */
export function calendarBounds(period) {
  const first = period.mesesAnio[0];
  const last = period.mesesAnio[period.mesesAnio.length - 1];
  return { inicio: monthStartUtc(first.anio, first.mes), fin: monthStartUtc(last.anio, last.mes + 1) };
}

/**
 * Resolves the dashboard period.
 *
 * @param {{periodo?: string, desde?: string, hasta?: string, anio?: number|string}} params
 * @param {Date} [now]
 * @returns {{ inicio: Date, fin: Date, etiqueta: string, mesesAnio: Array<{anio:number,mes:number,clave:string}>,
 *            previo: { inicio: Date, fin: Date, etiqueta: string, mesesAnio: Array } }}
 *   `[inicio, fin)` in UTC (fin exclusive).
 * @throws {ApiError} 400 VALIDATION_ERROR (invalid combination/date) | 400 PERIOD_TOO_LARGE (> 24 months)
 */
export function resolvePeriod({ periodo, desde, hasta, anio } = {}, now = new Date()) {
  const kind = periodo === undefined || periodo === null || periodo === '' ? 'mes_actual' : periodo;
  if (!PERIODOS.includes(kind)) throw validationError('periodo inválido', { periodo: 'Valor no permitido' });

  const hasDesdeHasta = desde !== undefined && desde !== null && desde !== '' || hasta !== undefined && hasta !== null && hasta !== '';
  const hasAnio = anio !== undefined && anio !== null && anio !== '';
  if (kind !== 'rango' && hasDesdeHasta) throw validationError('desde/hasta solo aplican con periodo=rango', { periodo: 'Combinación inválida' });
  if (kind !== 'anio' && hasAnio) throw validationError('anio solo aplica con periodo=anio', { periodo: 'Combinación inválida' });

  const today = toBogotaParts(now);
  let current;

  if (kind === 'mes_actual' || kind === 'mes_anterior') {
    const { anio: y, mes: m } = kind === 'mes_actual' ? today : shiftMonth(today.anio, today.mes, -1);
    current = buildPeriod(monthStartUtc(y, m), monthStartUtc(y, m + 1), monthLabelLong(y, m));
  } else if (kind === 'anio') {
    const y = hasAnio ? Number(anio) : today.anio;
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw validationError('anio inválido', { anio: 'Fuera de rango' });
    current = buildPeriod(monthStartUtc(y, 1), monthStartUtc(y + 1, 1), String(y));
  } else {
    if (!desde || !hasta) throw validationError('periodo=rango requiere desde y hasta', { desde: 'Requerido', hasta: 'Requerido' });
    const d = parseYmd(desde, 'desde');
    const h = parseYmd(hasta, 'hasta');
    const inicio = dayStartUtc(d);
    const fin = new Date(dayStartUtc(h).getTime() + 24 * HOUR_MS);
    if (fin.getTime() <= inicio.getTime()) throw validationError('hasta debe ser mayor o igual que desde', { hasta: 'Anterior a desde' });
    const months = (h.anio * 12 + h.mes) - (d.anio * 12 + d.mes) + 1;
    if (months > MAX_PERIOD_MONTHS) {
      throw new ApiError(400, `El rango no puede superar ${MAX_PERIOD_MONTHS} meses`, 'PERIOD_TOO_LARGE', { maxMeses: MAX_PERIOD_MONTHS });
    }
    current = buildPeriod(inicio, fin, `${desde} a ${hasta}`);
  }

  return { ...current, previo: previousOf(current) };
}

/** Public `periodo` block of every dashboard response. */
export function periodoResponse(period) {
  return {
    desde: toBogotaYmd(period.inicio),
    hasta: toBogotaYmd(new Date(period.fin.getTime() - 1)),
    etiqueta: period.etiqueta,
  };
}
