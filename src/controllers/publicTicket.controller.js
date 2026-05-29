'use strict';
import { serviceQrService } from '../services/serviceQr.service.js';
import { ticketService } from '../services/ticket.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * Fields stripped from every public ticket response per design D15.
 * Sanitization runs HERE — not in the model — so panel responses keep
 * full fidelity.
 */
const PUBLIC_TICKET_STRIP_FIELDS = [
  'internalNotes',
  'assignedTo',
  'closedBy',
  'createdBy',
  'qrId',
];

function sanitizeTicketForPublic(ticket) {
  if (!ticket) return ticket;
  const out = { ...ticket };
  for (const f of PUBLIC_TICKET_STRIP_FIELDS) {
    delete out[f];
  }
  // Drop tenant-internal audit fields that are not relevant to the public.
  delete out.tenantId;
  delete out.isDeleted;
  delete out.deletedAt;
  delete out.__v;
  return out;
}

export class PublicTicketController {
  /** POST /public/tickets/validate-access */
  async validateAccess(req, res, next) {
    try {
      const { qrToken, password } = req.body;
      const data = await serviceQrService.validateAccess({ qrToken, password });
      res.json(successResponse(data, 'Acceso autorizado'));
    } catch (err) { next(err); }
  }

  /** GET /public/tickets/session/me */
  async sessionMe(req, res, next) {
    try {
      const data = await serviceQrService.describeSession(req.publicSession);
      res.json(successResponse(data, 'Sesión pública'));
    } catch (err) { next(err); }
  }

  /** GET /public/tickets/equipments */
  async listEquipments(req, res, next) {
    try {
      const data = await ticketService.listEquipmentsForPublicSession(req.publicSession);
      res.json(successResponse(data, 'Equipos disponibles'));
    } catch (err) { next(err); }
  }

  /** POST /public/tickets */
  async createTickets(req, res, next) {
    try {
      const data = await ticketService.createBatchFromPublic(req.body, req.publicSession);
      res.status(201).json(successResponse(data, 'Tickets creados exitosamente', 201));
    } catch (err) { next(err); }
  }

  /** GET /public/tickets/list */
  async listTickets(req, res, next) {
    try {
      const tickets = await ticketService.listForPublicSession(req.publicSession, {
        limit: req.query.limit,
      });
      const sanitized = tickets.map(sanitizeTicketForPublic);
      res.json(successResponse(sanitized, 'Tickets de los últimos 30 días'));
    } catch (err) { next(err); }
  }

  /** GET /public/tickets/:id */
  async getTicket(req, res, next) {
    try {
      const ticket = await ticketService.findByIdForPublicSession(req.params.id, req.publicSession);
      res.json(successResponse(sanitizeTicketForPublic(ticket), 'Ticket recuperado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const publicTicketController = new PublicTicketController();
