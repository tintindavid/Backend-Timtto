'use strict';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

import { Ticket } from '../models/ticket.model.js';
import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { User } from '../models/user.model.js';

import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextTicketConsecutivos } from './counter.service.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';

import {
  TICKET_STATUS,
  TICKET_SOURCE,
  TICKET_CLOSING_REASON,
  URGENCY_TO_OT_PRIORITY,
  OT_PRIORITY_RANK,
} from '../constants/ticket.constants.js';

/**
 * TicketService — orchestrates ticket lifecycle and the cascades described in
 * design.md §Decisions D4, D11, D14, D18–D20.
 *
 * Cross-collection cascades (report close/cancel → ticket close, OT cancel →
 * tickets back to pendiente, equipo soft-delete → cancel pendiente tickets)
 * are exposed here as standalone methods and wired into the respective
 * services (ot.service / report.service / equipoitem.service).
 */
export class TicketService {
  /**
   * Build the equipo snapshot persisted on each ticket so the public list
   * survives equipo soft-delete (D20).
   */
  static _buildEquipoSnapshot(equipo) {
    return {
      nombre: equipo?.ItemId?.Nombre || equipo?.item || '',
      marca: equipo?.Marca || '',
      modelo: equipo?.Modelo || '',
      serie: equipo?.Serie || '',
      inventario: equipo?.Inventario || '',
      ubicacion: equipo?.Ubicacion || '',
      servicio: equipo?.Servicio?.nombre || '',
      sede: equipo?.SedeId?.nombreSede || '',
    };
  }

  /**
   * Load and validate that each equipoId belongs to the tenant AND to the
   * referenced (ClienteId, sedeId, servicioId). Returns the array of
   * populated equipos in the same order as input.
   */
  async _loadAndValidateEquipos(tenantId, { ClienteId, sedeId, servicioId, equipos }) {
    const equipoIds = equipos.map((e) => e.equipoId);
    const loaded = await EquipoItem.find(applyTenantFilter({ _id: { $in: equipoIds } }, tenantId))
      .populate('ItemId', 'Nombre')
      .populate('SedeId', 'nombreSede')
      .populate('Servicio', 'nombre')
      .lean();

    const byId = new Map(loaded.map((e) => [String(e._id), e]));

    const ordered = [];
    for (const entry of equipos) {
      const eq = byId.get(String(entry.equipoId));
      if (!eq) {
        throw new ApiError(400, 'Equipo no encontrado o no autorizado', 'INVALID_EQUIPO', {
          equipoId: entry.equipoId,
        });
      }
      if (String(eq.ClienteId) !== String(ClienteId)) {
        throw new ApiError(400, 'Equipo no pertenece al cliente indicado', 'EQUIPO_SCOPE_MISMATCH', {
          equipoId: entry.equipoId,
        });
      }
      if (String(eq.SedeId?._id || eq.SedeId) !== String(sedeId)) {
        throw new ApiError(400, 'Equipo no pertenece a la sede indicada', 'EQUIPO_SCOPE_MISMATCH', {
          equipoId: entry.equipoId,
        });
      }
      if (String(eq.Servicio?._id || eq.Servicio) !== String(servicioId)) {
        throw new ApiError(400, 'Equipo no pertenece al servicio indicado', 'EQUIPO_SCOPE_MISMATCH', {
          equipoId: entry.equipoId,
        });
      }
      ordered.push({ entry, equipo: eq });
    }

    return ordered;
  }

  /**
   * Internal: create N tickets atomically. Rolls back inserted documents if
   * any single insertion fails. Uses the array-form Model.create with
   * insertion order preserved so the consecutivo allocation order matches.
   */
  async _createBatch({
    tenantId,
    ClienteId,
    sedeId,
    servicioId,
    equipos,
    generalObservation,
    urgency,
    source,
    qrId,
    createdBy,
    requestedBy,
  }) {
    const ordered = await this._loadAndValidateEquipos(tenantId, {
      ClienteId,
      sedeId,
      servicioId,
      equipos,
    });

    const batchId = `BTC-${nanoid(12)}`;
    const consecutivos = await getNextTicketConsecutivos(tenantId, ordered.length);

    const docs = ordered.map(({ entry, equipo }, idx) => ({
      tenantId,
      consecutivo: consecutivos[idx].consecutivo,
      ClienteId,
      sedeId,
      servicioId,
      equipoId: equipo._id,
      equipoSnapshot: TicketService._buildEquipoSnapshot(equipo),
      status: TICKET_STATUS.PENDIENTE,
      urgency,
      batchId,
      source,
      qrId: qrId || null,
      requestedBy,
      observation: entry.observation || '',
      generalObservation: generalObservation || '',
      createdBy: createdBy || null,
    }));

    let created;
    try {
      created = await Ticket.insertMany(docs, { ordered: true });
    } catch (err) {
      // Best-effort rollback: remove anything that did get inserted.
      const insertedIds = (err && err.insertedDocs ? err.insertedDocs : []).map((d) => d._id);
      if (insertedIds.length) {
        await Ticket.deleteMany({ _id: { $in: insertedIds } }).catch(() => {});
      }
      logger.error('Ticket batch creation failed, rolled back', { err: String(err) });
      if (err && err.code === 11000) {
        throw new ApiError(409, 'Conflicto al asignar consecutivo, reintente', 'CONSECUTIVO_CONFLICT');
      }
      throw new ApiError(500, 'Error creando tickets', 'CREATE_BATCH_ERROR');
    }

    logger.info('Ticket batch created', {
      tenantId,
      batchId,
      count: created.length,
      source,
    });

    return {
      batchId,
      tickets: created.map((t) => ({ id: t._id.toString(), consecutivo: t.consecutivo })),
      created: created.length,
    };
  }

  /** Admin: POST /api/tickets */
  async createBatchFromAdmin(payload, tenantId, panelUser) {
    requireTenant(tenantId);
    if (!panelUser || !panelUser.userId) {
      throw new ApiError(401, 'No autenticado', 'NO_AUTH');
    }
    // Resolve display name + role for requestedBy from the panel session.
    const user = await User.findOne(applyTenantFilter({ _id: panelUser.userId }, tenantId)).lean();
    if (!user) throw new ApiError(401, 'Usuario no encontrado', 'USER_NOT_FOUND');

    const name = (user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Usuario');
    const position = user.role || 'admin';

    return this._createBatch({
      tenantId,
      ClienteId: payload.ClienteId,
      sedeId: payload.sedeId,
      servicioId: payload.servicioId,
      equipos: payload.equipos,
      generalObservation: payload.generalObservation,
      urgency: payload.urgency,
      source: TICKET_SOURCE.ADMIN,
      qrId: null,
      createdBy: user._id,
      requestedBy: { name, position },
    });
  }

  /** Public: POST /public/tickets */
  async createBatchFromPublic(payload, publicSession) {
    if (!publicSession) throw new ApiError(401, 'No public session', 'NO_SESSION');
    const tenantId = publicSession.tenantId;
    requireTenant(tenantId);

    // Enforce equipo scope == session scope (the validator above also
    // checks against (Cliente, Sede, Servicio) but the public session
    // pins those three explicitly per spec).
    return this._createBatch({
      tenantId,
      ClienteId: publicSession.ClienteId,
      sedeId: publicSession.sedeId,
      servicioId: publicSession.servicioId,
      equipos: payload.equipos,
      generalObservation: payload.generalObservation,
      urgency: payload.urgency,
      source: TICKET_SOURCE.QR,
      qrId: publicSession.serviceQrId,
      createdBy: null,
      requestedBy: payload.requestedBy,
    });
  }

  /** Panel list with filters. */
  async listForTenant(filters = {}, pagination = {}, tenantId) {
    requireTenant(tenantId);
    const { page = 1, limit = 20, sortBy = 'createdAt', order = 'desc', search } = pagination;
    const skip = (page - 1) * limit;

    const query = applyTenantFilter({ isDeleted: false }, tenantId);
    if (filters.status) {
      query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
    }
    ['ClienteId', 'sedeId', 'servicioId', 'equipoId', 'assignedTo', 'urgency', 'batchId', 'source'].forEach((k) => {
      if (filters[k]) query[k] = filters[k];
    });
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { consecutivo: rx },
        { 'equipoSnapshot.nombre': rx },
        { 'equipoSnapshot.serie': rx },
        { 'equipoSnapshot.inventario': rx },
        { 'requestedBy.name': rx },
      ];
    }

    const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
    const [data, total] = await Promise.all([
      Ticket.find(query)
        .populate('ClienteId', 'Razonsocial')
        .populate('sedeId', 'nombreSede')
        .populate('servicioId', 'nombre')
        .populate('assignedTo', 'firstName lastName email role')
        .populate('workOrderId', 'Consecutivo EstadoOt')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Ticket.countDocuments(query),
    ]);

    const enriched = data.map((t) => ({
      ...t,
      internalNotesCount: Array.isArray(t.internalNotes) ? t.internalNotes.length : 0,
    }));
    return {
      data: enriched,
      pagination: {
        page, limit, total, pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit), hasPrev: page > 1,
      },
    };
  }

  async findByIdForTenant(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });
    }
    const t = await Ticket.findOne(applyTenantFilter({ _id: id }, tenantId))
      .populate('ClienteId', 'Razonsocial Nit')
      .populate('sedeId', 'nombreSede')
      .populate('servicioId', 'nombre')
      .populate('assignedTo', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email role')
      .populate('closedBy', 'firstName lastName email role')
      .populate('workOrderId', 'Consecutivo EstadoOt TipoServicio OtPrioridad')
      .populate('reportId', 'consecutivo estado')
      .lean();
    if (!t) throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });
    return t;
  }

  async listByBatch(batchId, tenantId) {
    requireTenant(tenantId);
    if (!batchId) throw new ApiError(400, 'batchId requerido', 'INVALID_PARAMS');
    return Ticket.find(applyTenantFilter({ batchId }, tenantId))
      .sort({ createdAt: 1 })
      .populate('assignedTo', 'firstName lastName email role')
      .lean();
  }

  /** PATCH /api/tickets/:id/assign */
  async assign(id, responsableId, tenantId, panelUser) {
    requireTenant(tenantId);

    // Verify responsable belongs to tenant.
    const responsable = await User.findOne(applyTenantFilter({ _id: responsableId }, tenantId)).lean();
    if (!responsable) {
      throw new ApiError(404, 'Responsable no encontrado', 'USER_NOT_FOUND', { responsableId });
    }

    const ticket = await Ticket.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!ticket) throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });

    if (ticket.status === TICKET_STATUS.CERRADO || ticket.status === TICKET_STATUS.CANCELADO) {
      throw new ApiError(409, 'No se puede asignar un ticket cerrado o cancelado', 'TICKET_CLOSED');
    }

    const now = new Date();
    ticket.assignedTo = responsable._id;
    ticket.assignedAt = now;
    if (ticket.status === TICKET_STATUS.PENDIENTE) {
      ticket.status = TICKET_STATUS.EN_PROCESO;
    }
    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = now;
      const created = new Date(ticket.createdAt).getTime();
      ticket.responseTimeMinutes = Math.max(0, Math.round((now.getTime() - created) / 60000));
    }
    await ticket.save();
    logger.info('Ticket assigned', { tenantId, id, responsableId, panelUserId: panelUser?.userId });
    return ticket.toJSON();
  }

  /** POST /api/tickets/:id/note */
  async addNote(id, note, tenantId, panelUser) {
    requireTenant(tenantId);
    if (!panelUser || !panelUser.userId) throw new ApiError(401, 'No autenticado', 'NO_AUTH');
    const ticket = await Ticket.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      {
        $push: {
          internalNotes: {
            note,
            addedBy: panelUser.userId,
            addedAt: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!ticket) throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });
    return ticket.toJSON();
  }

  /** PATCH /api/tickets/:id/cancel — manual cancellation, only when pendiente && no OT */
  async cancel(id, { closingObservation }, tenantId, panelUser) {
    requireTenant(tenantId);
    const ticket = await Ticket.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!ticket) throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });

    if (ticket.workOrderId) {
      throw new ApiError(409, 'No se puede cancelar un ticket con OT asociada', 'CANNOT_CANCEL_TICKET_WITH_OT');
    }
    if (ticket.status !== TICKET_STATUS.PENDIENTE) {
      throw new ApiError(409, 'Solo se pueden cancelar tickets pendientes', 'INVALID_TICKET_STATE');
    }

    ticket.status = TICKET_STATUS.CANCELADO;
    ticket.closedAt = new Date();
    ticket.closingReason = TICKET_CLOSING_REASON.MANUAL;
    ticket.closedBy = panelUser?.userId || null;
    ticket.closingObservation = closingObservation || '';
    await ticket.save();
    logger.info('Ticket cancelled manually', { tenantId, id, panelUserId: panelUser?.userId });
    return ticket.toJSON();
  }

  // ===================================================================
  // ATOMIC OT CREATION (design D11)
  // ===================================================================
  /**
   * POST /api/tickets/work-order
   * Atomic: pre-allocate otId, conditional updateMany filters on
   * status=pendiente && workOrderId=null, verify modifiedCount === ticketIds.length,
   * rollback on mismatch. Then create the OT and one Report per ticket and
   * link reportId back on each ticket.
   */
  async createWorkOrder({ ticketIds, responsableId }, tenantId, panelUser) {
    requireTenant(tenantId);
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      throw new ApiError(400, 'ticketIds requerido', 'INVALID_PARAMS');
    }

    const responsable = await User.findOne(applyTenantFilter({ _id: responsableId }, tenantId)).lean();
    if (!responsable) {
      throw new ApiError(404, 'Responsable no encontrado', 'USER_NOT_FOUND', { responsableId });
    }

    const tickets = await Ticket.find(
      applyTenantFilter({ _id: { $in: ticketIds }, isDeleted: false }, tenantId)
    ).lean();

    if (tickets.length !== ticketIds.length) {
      throw new ApiError(409, 'Tickets no elegibles', 'TICKETS_NOT_ELIGIBLE');
    }

    // Eligibility: all pendiente, no workOrderId, single Cliente.
    const distinctClienteIds = new Set(tickets.map((t) => String(t.ClienteId)));
    if (distinctClienteIds.size !== 1) {
      throw new ApiError(400, 'Todos los tickets deben pertenecer al mismo cliente', 'MULTI_CLIENT_BATCH');
    }

    for (const t of tickets) {
      if (t.status !== TICKET_STATUS.PENDIENTE || t.workOrderId) {
        throw new ApiError(409, 'Tickets no elegibles', 'TICKETS_NOT_ELIGIBLE');
      }
    }

    const otId = new mongoose.Types.ObjectId();
    const now = new Date();

    // Atomic conditional claim: only tickets still pendiente && unclaimed
    // get updated. Returns modifiedCount; we verify it equals the requested
    // count and otherwise rollback.
    const claim = await Ticket.updateMany(
      applyTenantFilter(
        {
          _id: { $in: ticketIds },
          status: TICKET_STATUS.PENDIENTE,
          workOrderId: null,
          isDeleted: false,
        },
        tenantId
      ),
      {
        $set: {
          status: TICKET_STATUS.EN_PROCESO,
          workOrderId: otId,
          workOrderCreatedAt: now,
          assignedTo: responsable._id,
          assignedAt: now,
        },
      }
    );

    if (claim.modifiedCount !== ticketIds.length) {
      // Rollback: revert anything we changed under this otId (concurrent
      // request may have claimed a subset).
      await Ticket.updateMany(
        applyTenantFilter({ _id: { $in: ticketIds }, workOrderId: otId }, tenantId),
        {
          $set: {
            status: TICKET_STATUS.PENDIENTE,
            workOrderId: null,
            workOrderCreatedAt: null,
            assignedTo: null,
            assignedAt: null,
          },
        }
      ).catch((e) => logger.error('Failed to rollback ticket claim', { err: String(e) }));
      throw new ApiError(409, 'Tickets no elegibles (concurrencia)', 'TICKETS_NOT_ELIGIBLE');
    }

    // Compute first-response metric for tickets that didn't already have one.
    const responseUpdates = tickets
      .filter((t) => !t.firstResponseAt)
      .map((t) => ({
        id: t._id,
        responseTimeMinutes: Math.max(
          0,
          Math.round((now.getTime() - new Date(t.createdAt).getTime()) / 60000)
        ),
      }));
    if (responseUpdates.length) {
      await Promise.all(
        responseUpdates.map((u) =>
          Ticket.updateOne(
            applyTenantFilter({ _id: u.id }, tenantId),
            { $set: { firstResponseAt: now, responseTimeMinutes: u.responseTimeMinutes } }
          )
        )
      );
    }

    // Compute OT priority = max mapped urgency (design D18).
    const maxRank = tickets.reduce((acc, t) => {
      const mapped = URGENCY_TO_OT_PRIORITY[t.urgency] || 'Media';
      const rank = OT_PRIORITY_RANK[mapped] || 0;
      return Math.max(acc, rank);
    }, 0);
    const otPrioridad = (Object.entries(OT_PRIORITY_RANK).find(([, r]) => r === maxRank) || ['Media'])[0];

    // Allocate OT consecutivo.
    const otSeq = await getNextSequence(tenantId, 'OT');
    const otConsec = formatConsecutivo('OT', otSeq, 6);
    const otNorden = `N${String(otSeq).padStart(6, '0')}`;

    const clienteId = tickets[0].ClienteId;

    let otDoc;
    let createdReports = [];
    try {
      otDoc = await OT.create({
        _id: otId,
        Consecutivo: otConsec,
        Norden: otNorden,
        ClienteId: clienteId,
        EstadoOt: 'Pendiente',
        FechaCreacion: now,
        TipoServicio: 'Diagnostico',
        OtPrioridad: otPrioridad,
        ResponsableId: responsable._id,
        tenantId,
        isFromTicket: true,
        ticketIds: tickets.map((t) => t._id),
        reportes: [],
      });

      // Create one Report per ticket, linked back.
      const reportDocs = [];
      for (const t of tickets) {
        const seq = await getNextSequence(tenantId, 'REPORT');
        const consec = formatConsecutivo('R', seq, 6);
        reportDocs.push({
          tenantId,
          Equipo: t.equipoId,
          ClienteId: clienteId,
          consecutivo: consec,
          estado: 'Pendiente',
          FechaCreacion: now,
          orden: otId,
          tipoMtto: 'Diagnostico',
          fallaReportada: t.observation || '',
          ticket: t._id,
          isFromTicket: true,
          equipoSnapshot: {
            ItemText: t.equipoSnapshot?.nombre || '',
            Marca: t.equipoSnapshot?.marca || '',
            Modelo: t.equipoSnapshot?.modelo || '',
            Sede: t.equipoSnapshot?.sede || '',
            Serie: t.equipoSnapshot?.serie || '',
            Inventario: t.equipoSnapshot?.inventario || '',
            Servicio: t.equipoSnapshot?.servicio || '',
            Ubicacion: t.equipoSnapshot?.ubicacion || '',
            MesesMtto: [],
          },
        });
      }
      createdReports = await Report.insertMany(reportDocs, { ordered: true });

      // Link reportes onto OT and reportId onto each ticket.
      otDoc.reportes = createdReports.map((r) => r._id);
      await otDoc.save();

      await Promise.all(
        createdReports.map((r) =>
          Ticket.updateOne(
            applyTenantFilter({ _id: r.ticket }, tenantId),
            { $set: { reportId: r._id } }
          )
        )
      );

      logger.info('OT created from tickets', {
        tenantId,
        otId: otId.toString(),
        ticketCount: tickets.length,
        reportCount: createdReports.length,
        panelUserId: panelUser?.userId,
      });

      return {
        ot: otDoc.toJSON ? otDoc.toJSON() : otDoc,
        reports: createdReports.map((r) => ({
          id: r._id.toString(),
          ticketId: r.ticket.toString(),
          consecutivo: r.consecutivo,
        })),
        ticketIds: tickets.map((t) => t._id.toString()),
      };
    } catch (err) {
      // Compensating rollback: revert tickets and remove anything we created.
      logger.error('createWorkOrder failed mid-flight, rolling back', { err: String(err) });
      await Ticket.updateMany(
        applyTenantFilter({ _id: { $in: ticketIds }, workOrderId: otId }, tenantId),
        {
          $set: {
            status: TICKET_STATUS.PENDIENTE,
            workOrderId: null,
            workOrderCreatedAt: null,
            assignedTo: null,
            assignedAt: null,
            reportId: null,
          },
        }
      ).catch(() => {});
      if (createdReports.length) {
        await Report.deleteMany({ _id: { $in: createdReports.map((r) => r._id) } }).catch(() => {});
      }
      if (otDoc) {
        await OT.deleteOne({ _id: otId }).catch(() => {});
      }
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Error creando OT desde tickets', 'CREATE_OT_FROM_TICKETS_ERROR');
    }
  }

  // ===================================================================
  // CASCADE HOOKS — called by other services (design D14)
  // ===================================================================

  /**
   * Cascade: Report set to estado=Cerrado -> ticket status=cerrado.
   * No-op if the report is not linked to a ticket or the ticket is already
   * closed.
   */
  async closeFromReport(report, panelUser) {
    if (!report || !report.ticket || !report.isFromTicket) return null;
    const tenantId = report.tenantId;
    requireTenant(tenantId);

    const ticket = await Ticket.findOne(
      applyTenantFilter({ _id: report.ticket }, tenantId)
    );
    if (!ticket) return null;
    if (ticket.status === TICKET_STATUS.CERRADO || ticket.status === TICKET_STATUS.CANCELADO) {
      return ticket.toJSON();
    }

    const now = new Date();
    ticket.status = TICKET_STATUS.CERRADO;
    ticket.closedAt = now;
    ticket.closingReason = TICKET_CLOSING_REASON.OT_CLOSED;
    ticket.closingObservation = report.observacion || report.diagnostico || '';
    ticket.closedBy = panelUser?.userId || null;
    const created = new Date(ticket.createdAt).getTime();
    ticket.resolutionTimeMinutes = Math.max(0, Math.round((now.getTime() - created) / 60000));
    await ticket.save();
    logger.info('Ticket closed via report close cascade', { tenantId, ticketId: ticket._id.toString() });
    return ticket.toJSON();
  }

  /**
   * Cascade: Report cancelled -> ticket closed with reason=report_cancelled.
   * Ticket retains its reportId reference.
   */
  async cancelFromReport(report, panelUser) {
    if (!report || !report.ticket || !report.isFromTicket) return null;
    const tenantId = report.tenantId;
    requireTenant(tenantId);

    const ticket = await Ticket.findOne(applyTenantFilter({ _id: report.ticket }, tenantId));
    if (!ticket) return null;
    if (ticket.status === TICKET_STATUS.CERRADO || ticket.status === TICKET_STATUS.CANCELADO) {
      return ticket.toJSON();
    }

    const now = new Date();
    ticket.status = TICKET_STATUS.CERRADO;
    ticket.closedAt = now;
    ticket.closingReason = TICKET_CLOSING_REASON.REPORT_CANCELLED;
    ticket.closingObservation = `Report cancelled: ${report.motivoCancelacion || ''}`.trim();
    ticket.closedBy = panelUser?.userId || null;
    const created = new Date(ticket.createdAt).getTime();
    ticket.resolutionTimeMinutes = Math.max(0, Math.round((now.getTime() - created) / 60000));
    await ticket.save();
    logger.info('Ticket closed via report cancel cascade', { tenantId, ticketId: ticket._id.toString() });
    return ticket.toJSON();
  }

  /**
   * Cascade: OT (isFromTicket=true) cancelled -> revert each ticket to
   * pendiente, clear assignment + response metrics + workOrder fields.
   * Preserves batchId, consecutivo, requestedBy, observations, internalNotes.
   */
  async revertFromOTCancel(otId, tenantId) {
    requireTenant(tenantId);
    const ot = await OT.findOne(applyTenantFilter({ _id: otId }, tenantId)).lean();
    if (!ot || !ot.isFromTicket || !Array.isArray(ot.ticketIds) || ot.ticketIds.length === 0) {
      return { revertedCount: 0 };
    }

    const result = await Ticket.updateMany(
      applyTenantFilter({ _id: { $in: ot.ticketIds }, isDeleted: false }, tenantId),
      {
        $set: {
          status: TICKET_STATUS.PENDIENTE,
          workOrderId: null,
          workOrderCreatedAt: null,
          assignedTo: null,
          assignedAt: null,
          firstResponseAt: null,
          responseTimeMinutes: null,
          reportId: null,
        },
      }
    );
    logger.info('Tickets reverted from OT cancel', {
      tenantId,
      otId: String(otId),
      revertedCount: result.modifiedCount,
    });
    return { revertedCount: result.modifiedCount };
  }

  /**
   * Cascade: equipo soft-deleted -> cancel ONLY pendiente tickets referencing
   * the equipo. en_proceso / cerrado tickets are left intact (design D20).
   */
  async cancelOnEquipmentDelete(equipoId, tenantId, panelUser) {
    requireTenant(tenantId);
    const now = new Date();
    const result = await Ticket.updateMany(
      applyTenantFilter(
        { equipoId, status: TICKET_STATUS.PENDIENTE, isDeleted: false },
        tenantId
      ),
      {
        $set: {
          status: TICKET_STATUS.CANCELADO,
          closedAt: now,
          closingReason: TICKET_CLOSING_REASON.EQUIPMENT_DELETED,
          closingObservation: 'Equipo eliminado del inventario',
          closedBy: panelUser?.userId || null,
        },
      }
    );
    logger.info('Tickets cancelled on equipo soft-delete', {
      tenantId,
      equipoId: String(equipoId),
      cancelledCount: result.modifiedCount,
    });
    return { cancelledCount: result.modifiedCount };
  }

  // ===================================================================
  // PUBLIC LISTING
  // ===================================================================

  /**
   * GET /public/tickets/list — returns raw tickets within the session scope
   * and the last 30 days. The CONTROLLER applies sanitization per D15.
   */
  async listForPublicSession(publicSession, { limit = 100 } = {}) {
    if (!publicSession) throw new ApiError(401, 'No session', 'NO_SESSION');
    const tenantId = publicSession.tenantId;
    requireTenant(tenantId);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const query = applyTenantFilter(
      {
        ClienteId: publicSession.ClienteId,
        sedeId: publicSession.sedeId,
        servicioId: publicSession.servicioId,
        createdAt: { $gte: since },
        isDeleted: false,
      },
      tenantId
    );
    return Ticket.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, Number(limit) || 100)))
      .lean();
  }

  async findByIdForPublicSession(id, publicSession) {
    if (!publicSession) throw new ApiError(401, 'No session', 'NO_SESSION');
    const tenantId = publicSession.tenantId;
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });
    }
    const t = await Ticket.findOne(
      applyTenantFilter(
        {
          _id: id,
          ClienteId: publicSession.ClienteId,
          sedeId: publicSession.sedeId,
          servicioId: publicSession.servicioId,
        },
        tenantId
      )
    ).lean();
    if (!t) throw new ApiError(404, 'Ticket no encontrado', 'NOT_FOUND', { id });
    return t;
  }

  /** Equipments available to the current public session. */
  async listEquipmentsForPublicSession(publicSession) {
    if (!publicSession) throw new ApiError(401, 'No session', 'NO_SESSION');
    const tenantId = publicSession.tenantId;
    requireTenant(tenantId);

    return EquipoItem.find(
      applyTenantFilter(
        {
          ClienteId: publicSession.ClienteId,
          SedeId: publicSession.sedeId,
          Servicio: publicSession.servicioId,
          isDeleted: false,
        },
        tenantId
      )
    )
      .populate('ItemId', 'Nombre')
      .select('Marca Modelo Serie Inventario Ubicacion EstadoOperativo ItemId Riesgo')
      .lean();
  }

  /** Aggregate counts by status for dashboard widgets. */
  async statsForTenant(tenantId) {
    requireTenant(tenantId);
    const agg = await Ticket.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const stats = { pendiente: 0, en_proceso: 0, cerrado: 0, cancelado: 0 };
    for (const row of agg) {
      if (row && row._id && row._id in stats) stats[row._id] = row.count;
    }
    stats.total = Object.values(stats).reduce((acc, n) => acc + n, 0);
    return stats;
  }
}

export const ticketService = new TicketService();
