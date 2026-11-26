'use strict';

import { EquipoItem } from '../models/equipoitem.model.js';
import { Items } from '../models/items.model.js';
import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Servicios } from '../models/servicios.model.js';
import { HVEquipo } from '../models/hvequipo.model.js';
import { Report } from '../models/report.model.js';
import { OT } from '../models/ot.model.js';
import { EquipoActividadExterna } from '../models/equipoActividadExterna.model.js';
import { Ticket } from '../models/ticket.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { ctxHasPermission } from '../utils/dashboardContext.util.js';
import { ApiError } from '../utils/apiError.util.js';

/**
 * Consolidated summary of one equipment (change: buscador-equipos). Each section mirrors the guard of the equivalent
 * existing read endpoint; without it the section is empty with `disponible: false` and its collection is not queried.
 *
 *  - hojaVida             GET /hv-equipo/equipo/:equipoId        hv-equipos:read
 *  - mantenimientos       GET /reports/equipo/:equipoId          reports:read (executesServices only gates writes)
 *  - actividadesExternas  GET /equipos/:id/actividades-externas  capability registersExternal
 *  - tickets              GET /tickets                           capability usesQrs + tickets:read
 *  - repuestos            GET /repuestos/equipo/:equipoId        repuestos:read
 */

const RECENT_LIMIT = 5;

const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const findFirst = async (Model, filter, select, sort = { _id: 1 }) => {
  const [doc] = await Model.find({ ...filter, isDeleted: false }).select(select).sort(sort).limit(1).lean();
  return doc || null;
};

/**
 * Rows are ordered here because the displayed date is the first one present among several fields; the rows of ONE
 * equipment are few and only the listed fields are read.
 */
async function section(allowed, Model, filter, select, toRow) {
  if (!allowed) return { disponible: false, total: 0, recientes: [] };
  const docs = await Model.find({ ...filter, isDeleted: false }).select(select).lean();
  const rows = docs.map(toRow).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  return { disponible: true, total: rows.length, recientes: rows.slice(0, RECENT_LIMIT) };
}

/** Replaces the work order id of each listed report with `{ _id, consecutivo }` (null when it no longer exists). */
async function attachWorkOrders(mantenimientos, tenantId) {
  const ids = [...new Set(mantenimientos.recientes.map((r) => r.ot).filter(Boolean))];
  const ots = ids.length
    ? await OT.find({ tenantId, _id: { $in: ids }, isDeleted: false }).select('Consecutivo').lean()
    : [];
  const byId = new Map(ots.map((o) => [String(o._id), o.Consecutivo || null]));
  const recientes = mantenimientos.recientes.map((r) => ({
    ...r,
    ot: byId.has(r.ot) ? { _id: r.ot, consecutivo: byId.get(r.ot) } : null,
  }));
  return { ...mantenimientos, recientes };
}

const toMantenimiento = (r) => ({
  _id: String(r._id),
  consecutivo: r.consecutivo || null,
  estado: r.estado || null,
  tipoMtto: r.tipoMtto || null,
  fecha: toIso(r.fechaFinalizdo || r.fechaProcesado || r.FechaCreacion || r.createdAt),
  ot: r.orden ? String(r.orden) : null,
});

const toActividadExterna = (a) => ({
  _id: String(a._id),
  tipo: a.tipo || null,
  consecutivo: a.consecutivoExterno || null,
  fecha: toIso(a.fecha),
  proveedor: a.proveedor || null,
  estadoFinal: a.estadoFinal || null,
});

const toTicket = (t) => ({
  _id: String(t._id),
  consecutivo: t.consecutivo || null,
  status: t.status || null,
  urgency: t.urgency || null,
  fecha: toIso(t.createdAt),
});

const toRepuesto = (r) => ({
  _id: String(r._id),
  nombre: r.nombre || null,
  cantidad: r.Cantidad ?? null,
  estado: r.EstadoSolicitud || null,
  fecha: toIso(r.FechaSolicitud || r.createdAt),
});

export class ResumenEquipoService {
  /**
   * @param {ReturnType<import('../utils/busquedaContext.util.js').buildBusquedaContext>} ctx
   * @param {string} equipoId
   */
  async resumen(ctx, equipoId) {
    const { tenantId } = ctx;
    const equipo = await findFirst(
      EquipoItem,
      { _id: equipoId, tenantId, ...(ctx.clienteId ? { ClienteId: ctx.clienteId } : {}) },
      '-estadoOperativoHistory',
    );
    if (!equipo) throw new ApiError(404, 'Equipo no encontrado', 'NOT_FOUND');

    const id = equipo._id;
    const can = (permission) => ctxHasPermission(ctx, permission);
    const canReadHv = can(PERMISSIONS.HV_EQUIPOS_READ);
    const related = (Model, relatedId, select) => (
      relatedId ? findFirst(Model, { _id: relatedId, tenantId }, select) : null
    );

    const [item, cliente, sede, servicio, hv, mantenimientos, actividadesExternas, tickets, repuestos] = await Promise.all([
      related(Items, equipo.ItemId, 'Nombre Foto'),
      related(Customer, equipo.ClienteId, 'Razonsocial'),
      related(Sedes, equipo.SedeId, 'nombreSede'),
      related(Servicios, equipo.Servicio, 'nombre'),
      canReadHv ? findFirst(HVEquipo, { EquipoId: id, tenantId }, 'EstadoHV Foto', { createdAt: -1 }) : null,
      section(
        can(PERMISSIONS.REPORTS_READ), Report, { Equipo: id, tenantId },
        'consecutivo estado tipoMtto fechaFinalizdo fechaProcesado FechaCreacion createdAt orden', toMantenimiento,
      ),
      section(
        Boolean(ctx.capabilities.registersExternal), EquipoActividadExterna, { equipoId: id, tenantId },
        'tipo consecutivoExterno fecha proveedor estadoFinal', toActividadExterna,
      ),
      section(
        Boolean(ctx.capabilities.usesQrs) && can(PERMISSIONS.TICKETS_READ), Ticket, { equipoId: id, tenantId },
        'consecutivo status urgency createdAt', toTicket,
      ),
      section(
        can(PERMISSIONS.REPUESTOS_READ), Repuestos, { EquipoId: id, tenantId },
        'nombre Cantidad EstadoSolicitud FechaSolicitud createdAt', toRepuesto,
      ),
    ]);

    return {
      equipo: {
        _id: String(equipo._id),
        nombre: item?.Nombre || equipo.item || null,
        marca: equipo.Marca || null,
        modelo: equipo.Modelo || null,
        serie: equipo.Serie || null,
        inventario: equipo.Inventario || null,
        invima: equipo.Invima || null,
        riesgo: equipo.Riesgo || null,
        ubicacion: equipo.Ubicacion || null,
        estado: equipo.Estado || null,
        estadoOperativo: equipo.EstadoOperativo || null,
        sede: sede?.nombreSede || null,
        servicio: servicio?.nombre || null,
        mesesMtto: Array.isArray(equipo.mesesMtto) ? equipo.mesesMtto : [],
        ultimoMtto: toIso(equipo.UltimoMtto),
        // Stored as text (the next scheduled month), not as a date.
        proximoMtto: equipo.ProximoMtto || null,
        foto: hv?.Foto || item?.Foto || null,
      },
      cliente: cliente ? { _id: String(cliente._id), nombre: cliente.Razonsocial || null } : null,
      hojaVida: {
        disponible: canReadHv,
        existe: Boolean(hv),
        _id: hv ? String(hv._id) : null,
        estado: hv?.EstadoHV || null,
      },
      mantenimientos: await attachWorkOrders(mantenimientos, tenantId),
      actividadesExternas,
      tickets,
      repuestos,
    };
  }
}

export const resumenEquipoService = new ResumenEquipoService();
