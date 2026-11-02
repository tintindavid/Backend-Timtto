import mongoose from 'mongoose';
import { Requisicion } from '../models/requisicion.model.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';
import { buildPagination } from '../utils/pagination.util.js';
import { toPublicPopulatedList } from '../utils/requisicionPublic.util.js';
import {
  REQUISICION_ACCIONES_HISTORIAL,
  REQUISICION_MI_ACTIVIDAD_MAX,
  REQUISICION_TZ_OFFSET,
  TIMELINE_ACTOR_TIPO,
} from '../constants/requisicion.constants.js';

/**
 * "Mi historial" (change: requisiciones-mi-historial): requisitions where the caller acted, with the caller's own
 * timeline events. Everything is scoped by the tenant and the user taken from the token; only user-authored events count.
 */

const dayStart = (d) => new Date(`${d}T00:00:00.000${REQUISICION_TZ_OFFSET}`);
const dayEnd = (d) => new Date(`${d}T23:59:59.999${REQUISICION_TZ_OFFSET}`);

/**
 * Same filters as the plain list (aggregate does not cast, so ids become ObjectIds). `sortBy`/`order` do not apply:
 * the order is fixed (last own action desc).
 */
function filtersMatch(filters = {}) {
  const out = {};
  if (filters.estado) out.estado = filters.estado;
  for (const key of ['areaId', 'tipoRequisicionId', 'creadaPor']) {
    if (filters[key]) out[key] = toObjectId(filters[key]) ?? null;
  }
  if (filters.fechaDesde || filters.fechaHasta) {
    out.createdAt = {};
    if (filters.fechaDesde) out.createdAt.$gte = dayStart(filters.fechaDesde);
    if (filters.fechaHasta) out.createdAt.$lte = dayEnd(filters.fechaHasta);
  }
  if (filters.search) {
    const rx = new RegExp(escapeRegex(filters.search), 'i');
    out.$or = [{ consecutivo: rx }, { titulo: rx }];
  }
  return out;
}

/**
 * One user action = one entry: RECHAZADA is dropped when the same user's NIVEL_RECHAZADO has the same fecha, and events
 * of the same type within the same minute (multi-line confirmations / receptions) collapse into the newest. Newest first, capped.
 */
export function compactActividad(events = []) {
  const sorted = [...events].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const rejectedAt = new Set(sorted.filter((e) => e.tipo === 'NIVEL_RECHAZADO').map((e) => new Date(e.fecha).getTime()));
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    const t = new Date(e.fecha).getTime();
    if (e.tipo === 'RECHAZADA' && rejectedAt.has(t)) continue;
    const key = `${e.tipo}|${Math.floor(t / 60000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, REQUISICION_MI_ACTIVIDAD_MAX);
}

const toObjectId = (id) => (mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null);

/** Event types for an `accion` (`todo`/undefined = union of all). */
export function tiposForAccion(accion) {
  if (accion && accion !== 'todo' && REQUISICION_ACCIONES_HISTORIAL[accion]) return [...REQUISICION_ACCIONES_HISTORIAL[accion]];
  return [...new Set(Object.values(REQUISICION_ACCIONES_HISTORIAL).flat())];
}

/** True when the user created, requested, is responsible of a line, or acted (user event) on the requisition document. */
export function isParticipant(doc, userId) {
  const uid = String(userId ?? '');
  if (!uid || !doc) return false;
  const s = (v) => (v === null || v === undefined ? '' : String(v));
  if (s(doc.creadaPor) === uid || s(doc.solicitanteId) === uid) return true;
  if ((doc.lineas || []).some((l) => s(l?.responsableId) === uid)) return true;
  return (doc.timeline || []).some((e) => e?.actor?.tipo === TIMELINE_ACTOR_TIPO.USUARIO && s(e.actor.usuarioId) === uid);
}

/** Mongo filter matching the requisitions the user participated in (used by the by-participation detail). */
export function participationFilter(userId) {
  const oid = toObjectId(userId);
  if (!oid) return { _id: null };
  return {
    $or: [
      { creadaPor: oid },
      { solicitanteId: oid },
      { 'lineas.responsableId': oid },
      { timeline: { $elemMatch: { 'actor.tipo': TIMELINE_ACTOR_TIPO.USUARIO, 'actor.usuarioId': oid } } },
    ],
  };
}

export async function listMiHistorial(tenantId, userId, accion, { page = 1, limit = 10 } = {}, filters = {}) {
  requireTenant(tenantId);
  const oid = toObjectId(userId);
  if (!oid) return { data: [], pagination: buildPagination(page, limit, 0) };
  const tipos = tiposForAccion(accion);
  const ownEvent = { 'actor.tipo': TIMELINE_ACTOR_TIPO.USUARIO, 'actor.usuarioId': oid, tipo: { $in: tipos } };
  const match = applyTenantFilter({ ...filtersMatch(filters), isDeleted: { $ne: true }, timeline: { $elemMatch: ownEvent } }, tenantId);
  const own = {
    $filter: {
      input: '$timeline',
      as: 'e',
      cond: { $and: [
        { $eq: ['$$e.actor.tipo', TIMELINE_ACTOR_TIPO.USUARIO] },
        { $eq: ['$$e.actor.usuarioId', oid] },
        { $in: ['$$e.tipo', tipos] },
      ] },
    },
  };

  const [found, total] = await Promise.all([
    Requisicion.aggregate([
      { $match: match },
      { $addFields: { _mis: own } },
      { $addFields: { _ultima: { $max: '$_mis.fecha' } } },
      { $sort: { _ultima: -1, _id: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $unset: 'timeline' },
    ]),
    Requisicion.countDocuments(match),
  ]);

  const actividad = found.map((r) => compactActividad(r._mis || []).map((e) => ({
    tipo: e.tipo,
    fecha: e.fecha,
    ...(e.estadoNuevo ? { estadoNuevo: e.estadoNuevo } : {}),
    ...(e.datos?.nivel !== undefined && e.datos?.nivel !== null ? { nivel: e.datos.nivel } : {}),
  })));
  const rows = found.map(({ _mis, _ultima, ...rest }) => rest);
  const data = await toPublicPopulatedList(rows);
  return { data: data.map((row, i) => ({ ...row, miActividad: actividad[i] })), pagination: buildPagination(page, limit, total) };
}
