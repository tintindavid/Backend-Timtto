'use strict';

import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Ticket } from '../models/ticket.model.js';
import { Requisicion } from '../models/requisicion.model.js';
import { periodoResponse } from '../utils/dashboardPeriod.util.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { TICKET_STATUS } from '../constants/ticket.constants.js';
import { REQUISICION_ESTADO } from '../constants/requisicion.constants.js';
import { ctxHasPermission } from '../utils/dashboardContext.util.js';
import {
  equipoMatch, reportBaseMatch, hasExecution, unavailable, oid, customerNames, tipoMttoMatch, DAY_MS, notApplied,
} from './dashboard.common.js';

/**
 * Operational indicators and alerts (change: dashboard-por-tenant-indicadores, design D9/D10).
 * A section the tenant has no module/capability/permission for is `{ disponible: false }` (HTTP 200, never 403).
 */

/** Provisional threshold (design Open Question): an unfinished work order older than this is overdue. */
export const OT_VENCIDA_DIAS = 30;
export const SIN_MANTENIMIENTO_MESES = 12;
export const ALERT_ITEMS_LIMIT = 10;
export const OT_ESTADOS_TERMINADOS = Object.freeze(['Completado', 'Cerrado', 'Cancelado']);
/** Requisitions waiting for a decision: sent and in approval. */
export const REQUISICION_ESTADOS_PENDIENTES = Object.freeze([REQUISICION_ESTADO.ENVIADA, REQUISICION_ESTADO.EN_APROBACION]);
export const TICKET_ESTADOS_ABIERTOS = Object.freeze([TICKET_STATUS.PENDIENTE, TICKET_STATUS.EN_PROCESO]);

const toEstadoItems = (rows) =>
  rows
    .map((r) => ({ estado: r._id || 'Sin estado', cantidad: r.n }))
    .sort((a, b) => b.cantidad - a.cantidad || a.estado.localeCompare(b.estado));

export class DashboardOperativosService {
  async _otsPorEstado(ctx) {
    const match = { tenantId: ctx.tenantId, isDeleted: false, FechaCreacion: { $gte: ctx.period.inicio, $lt: ctx.period.fin } };
    if (ctx.filters.clienteId) match.ClienteId = oid(ctx.filters.clienteId, 'clienteId');
    if (ctx.filters.tipoMtto) match.TipoServicio = tipoMttoMatch(ctx.filters.tipoMtto);
    const rows = await OT.aggregate([{ $match: match }, { $group: { _id: '$EstadoOt', n: { $sum: 1 } } }]);
    return { disponible: true, items: toEstadoItems(rows) };
  }

  async _preventivoVsCorrectivo(ctx) {
    const match = await reportBaseMatch(ctx);
    match.FechaCreacion = { $gte: ctx.period.inicio, $lt: ctx.period.fin };
    match.estado = { $ne: 'Cancelado' };
    if (ctx.filters.tipoMtto) match.tipoMtto = tipoMttoMatch(ctx.filters.tipoMtto);
    if (ctx.filters.tecnicoId) match.ResponsableMtto = oid(ctx.filters.tecnicoId, 'tecnicoId');
    const rows = await Report.aggregate([{ $match: match }, { $group: { _id: '$tipoMtto', n: { $sum: 1 } } }]);
    const out = { disponible: true, preventivo: 0, correctivo: 0, otros: 0 };
    for (const r of rows) {
      if ((r._id || 'Preventivo') === 'Preventivo') out.preventivo += r.n;
      else if (r._id === 'Correctivo') out.correctivo += r.n;
      else out.otros += r.n;
    }
    return out;
  }

  async _equiposPorEstadoOperativo(ctx) {
    const rows = await EquipoItem.aggregate([
      { $match: equipoMatch(ctx) },
      { $group: { _id: '$EstadoOperativo', n: { $sum: 1 } } },
    ]);
    return { disponible: true, items: toEstadoItems(rows) };
  }

  async _ticketsAbiertos(ctx) {
    if (!ctx.capabilities?.usesQrs || !ctxHasPermission(ctx, PERMISSIONS.TICKETS_READ)) return unavailable();
    const match = { tenantId: ctx.tenantId, isDeleted: false, status: { $in: [...TICKET_ESTADOS_ABIERTOS] } };
    if (ctx.filters.clienteId) match.ClienteId = oid(ctx.filters.clienteId, 'clienteId');
    if (ctx.filters.sedeId) match.sedeId = oid(ctx.filters.sedeId, 'sedeId');
    if (ctx.filters.servicioId) match.servicioId = oid(ctx.filters.servicioId, 'servicioId');
    return { disponible: true, cantidad: await Ticket.countDocuments(match) };
  }

  async _requisicionesPendientes(ctx) {
    if (!ctx.capabilities?.usesRequisiciones || !ctxHasPermission(ctx, PERMISSIONS.REQUISICIONES_READ)) return unavailable();
    const match = { tenantId: ctx.tenantId, isDeleted: false, estado: { $in: [...REQUISICION_ESTADOS_PENDIENTES] } };
    // Same scoping as the requisitions list: tenant-wide only with requisiciones:reports (or superadmin); with just
    // requisiciones:read the count is the user's own "mias" view (creadaPor / solicitanteId).
    if (!ctxHasPermission(ctx, PERMISSIONS.REQUISICIONES_REPORTS)) {
      match.$or = [{ creadaPor: ctx.userId }, { solicitanteId: ctx.userId }];
    }
    return { disponible: true, cantidad: await Requisicion.countDocuments(match) };
  }

  /** GET /dashboard/operativos */
  async operativos(ctx) {
    const exec = hasExecution(ctx);
    const [ots, preventivoVsCorrectivo, equipos, tickets, requisiciones] = await Promise.all([
      exec ? this._otsPorEstado(ctx) : unavailable(),
      exec ? this._preventivoVsCorrectivo(ctx) : unavailable(),
      this._equiposPorEstadoOperativo(ctx),
      this._ticketsAbiertos(ctx),
      this._requisicionesPendientes(ctx),
    ]);
    // Filters sent that at least one AVAILABLE section ignores (design: each section applies what it can).
    const ignored = [];
    if (ots.disponible) ignored.push('sedeId', 'servicioId', 'tecnicoId');
    ignored.push('tipoMtto', 'tecnicoId'); // equipment by operating state (always available) ignores both
    if (tickets.disponible) ignored.push('tipoMtto', 'tecnicoId');
    if (requisiciones.disponible) ignored.push('clienteId', 'sedeId', 'servicioId', 'tipoMtto', 'tecnicoId');
    return {
      periodo: periodoResponse(ctx.period),
      filtrosNoAplicados: notApplied(ctx, ignored),
      otsPorEstado: ots,
      preventivoVsCorrectivo,
      equiposPorEstadoOperativo: equipos,
      ticketsAbiertos: tickets,
      requisicionesPendientes: requisiciones,
    };
  }

  async _otsVencidas(ctx) {
    const limite = new Date(ctx.now.getTime() - OT_VENCIDA_DIAS * DAY_MS);
    const match = {
      tenantId: ctx.tenantId,
      isDeleted: false,
      EstadoOt: { $nin: [...OT_ESTADOS_TERMINADOS] },
      FechaCreacion: { $lt: limite },
    };
    if (ctx.filters.clienteId) match.ClienteId = oid(ctx.filters.clienteId, 'clienteId');
    if (ctx.filters.tipoMtto) match.TipoServicio = tipoMttoMatch(ctx.filters.tipoMtto);
    const [cantidad, ots] = await Promise.all([
      OT.countDocuments(match),
      OT.find(match).select('Consecutivo ClienteId FechaCreacion').sort({ FechaCreacion: 1 }).limit(ALERT_ITEMS_LIMIT).lean(),
    ]);
    const names = await customerNames(ctx.tenantId, ots.map((o) => o.ClienteId));
    return {
      disponible: true,
      cantidad,
      items: ots.map((o) => ({
        otId: String(o._id),
        consecutivo: o.Consecutivo || '',
        cliente: names.get(String(o.ClienteId)) || '',
        diasAbierta: Math.floor((ctx.now.getTime() - new Date(o.FechaCreacion).getTime()) / DAY_MS),
      })),
    };
  }

  async _equiposSinMantenimiento(ctx) {
    const limite = new Date(ctx.now);
    limite.setUTCMonth(limite.getUTCMonth() - SIN_MANTENIMIENTO_MESES);
    const match = { ...equipoMatch(ctx), $or: [{ UltimoMtto: null }, { UltimoMtto: { $lt: limite } }] };
    const [cantidad, equipos] = await Promise.all([
      EquipoItem.countDocuments(match),
      EquipoItem.find(match).select('item Serie UltimoMtto ItemId').populate('ItemId', 'Nombre').sort({ UltimoMtto: 1 }).limit(ALERT_ITEMS_LIMIT).lean(),
    ]);
    return {
      disponible: true,
      cantidad,
      items: equipos.map((e) => ({
        equipoId: String(e._id),
        nombre: e.item || e.ItemId?.Nombre || '',
        serie: e.Serie || '',
        ultimoMtto: e.UltimoMtto ? new Date(e.UltimoMtto).toISOString() : null,
      })),
    };
  }

  /** GET /dashboard/alertas */
  async alertas(ctx) {
    const [otsVencidas, equiposSinMantenimiento] = await Promise.all([
      hasExecution(ctx) ? this._otsVencidas(ctx) : unavailable(),
      this._equiposSinMantenimiento(ctx),
    ]);
    // otsVencidas ignores sede/servicio/tecnico; equipment without maintenance ignores tipoMtto/tecnico.
    const ignored = ['tipoMtto', 'tecnicoId'];
    if (otsVencidas.disponible) ignored.push('sedeId', 'servicioId');
    return { periodo: periodoResponse(ctx.period), filtrosNoAplicados: notApplied(ctx, ignored), otsVencidas, equiposSinMantenimiento };
  }
}

export const dashboardOperativosService = new DashboardOperativosService();
