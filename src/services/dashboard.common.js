'use strict';

import mongoose from 'mongoose';
import { ApiError } from '../utils/apiError.util.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Customer } from '../models/customer.model.js';
import { classifyReportForOt } from './informeReport.helpers.js';

/**
 * Shared building blocks of the dashboard services (change: dashboard-por-tenant-indicadores).
 * Every match produced here starts with `tenantId` (aggregations do NOT cast ids: they are converted to
 * ObjectId by hand) and soft-deleted documents are excluded explicitly (aggregations skip the find hooks).
 */

export const REPORT_ESTADOS = Object.freeze(['Pendiente', 'Abierto', 'En Progreso', 'Cerrado', 'Cancelado', 'Procesado']);
/** Reports "done" by the by-OT classification (design D5): reuses `classifyReportForOt`, no second definition. */
export const DONE_ESTADOS = Object.freeze(REPORT_ESTADOS.filter((estado) => classifyReportForOt({ estado }) === 'Cumplido'));
export const OPEN_REPORT_ESTADOS = Object.freeze(['Pendiente', 'Abierto', 'En Progreso']);

export const DAY_MS = 24 * 3600 * 1000;
/** Cap of equipment ids used to resolve the site/service filter on reports. */
export const MAX_EQUIPO_IDS = 20000;

/**
 * Names of the filters that were SENT but not applied by an endpoint: `names` are the filters it can never apply,
 * plus the ones that could not be applied at runtime (`ctx.ignoredFilters`, e.g. site/service over the id cap).
 */
export function notApplied(ctx, names = []) {
  const out = new Set(names.filter((n) => ctx.filters[n]));
  for (const n of ctx.ignoredFilters || []) out.add(n);
  return [...out];
}

export const unavailable = () => ({ disponible: false });

/** ObjectId from a validated id; an invalid value is a 400, never a CastError/500. */
export function oid(value, field = 'id') {
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw new ApiError(400, `${field} inválido`, 'VALIDATION_ERROR', { [field]: 'ObjectId inválido' });
  }
  return new mongoose.Types.ObjectId(String(value));
}

/** True when the tenant executes services (reports and work orders exist). */
export const hasExecution = (ctx) => Boolean(ctx.capabilities?.executesServices);

const DIAGNOSTICO_VARIANTS = ['Diagnostico', 'Diagnóstico'];
export function tipoMttoMatch(tipo) {
  return DIAGNOSTICO_VARIANTS.includes(tipo) ? { $in: DIAGNOSTICO_VARIANTS } : tipo;
}

/** Equipment filter (tenant + customer/site/service). */
export function equipoMatch(ctx) {
  const { clienteId, sedeId, servicioId } = ctx.filters;
  const match = { tenantId: ctx.tenantId, isDeleted: false };
  if (clienteId) match.ClienteId = oid(clienteId, 'clienteId');
  if (sedeId) match.SedeId = oid(sedeId, 'sedeId');
  if (servicioId) match.Servicio = oid(servicioId, 'servicioId');
  return match;
}

/**
 * Report base match: tenant + customer, and site/service resolved THROUGH the equipment (the report only keeps
 * their names in its snapshot).
 */
export async function reportBaseMatch(ctx) {
  const { clienteId, sedeId, servicioId } = ctx.filters;
  const match = { tenantId: ctx.tenantId, isDeleted: false };
  if (clienteId) match.ClienteId = oid(clienteId, 'clienteId');
  if (sedeId || servicioId) {
    const rows = await EquipoItem.find(equipoMatch(ctx)).select('_id').limit(MAX_EQUIPO_IDS + 1).lean();
    if (rows.length > MAX_EQUIPO_IDS) {
      // Too many equipment to resolve the filter: it is NOT applied and the response says so (filtrosNoAplicados).
      if (sedeId) ctx.ignoredFilters?.add('sedeId');
      if (servicioId) ctx.ignoredFilters?.add('servicioId');
    } else {
      match.Equipo = { $in: rows.map((r) => r._id) };
    }
  }
  return match;
}

/** Technician filter on the attribution rule of design D7: `procesadoPor.userId`, else `ResponsableMtto`. */
export function attributionMatch(userId) {
  const id = oid(userId, 'tecnicoId');
  return { $or: [{ 'procesadoPor.userId': id }, { 'procesadoPor.userId': null, ResponsableMtto: id }] };
}

/** Date condition of "done in the period": `fechaProcesado`, falling back to `fechaFinalizdo` (design D5). */
export function doneDateMatch(period) {
  const range = { $gte: period.inicio, $lt: period.fin };
  return { $or: [{ fechaProcesado: range }, { fechaProcesado: null, fechaFinalizdo: range }] };
}

/**
 * Match of the reports done in the period. `tipoMtto` and `tecnicoId` filters apply when `withTecnico`/`withTipo`.
 */
export async function doneInPeriodMatch(ctx, { withTipo = true, withTecnico = true, onlyProcesado = false } = {}) {
  const match = await reportBaseMatch(ctx);
  match.estado = { $in: [...DONE_ESTADOS] };
  if (withTipo && ctx.filters.tipoMtto) match.tipoMtto = tipoMttoMatch(ctx.filters.tipoMtto);
  const and = [onlyProcesado ? { fechaProcesado: { $gte: ctx.period.inicio, $lt: ctx.period.fin } } : doneDateMatch(ctx.period)];
  if (withTecnico && ctx.filters.tecnicoId) and.push(attributionMatch(ctx.filters.tecnicoId));
  match.$and = and;
  return match;
}

/** Customer names by id (tenant scoped). */
export async function customerNames(tenantId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await Customer.find({ tenantId, _id: { $in: unique.map((id) => oid(id)) } }).select('Razonsocial').lean();
  return new Map(rows.map((c) => [String(c._id), c.Razonsocial || '']));
}
