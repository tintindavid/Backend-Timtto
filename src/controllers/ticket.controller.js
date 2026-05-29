'use strict';
import { ticketService } from '../services/ticket.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class TicketController {
  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, search, ...filters } = req.query;
      const result = await ticketService.listForTenant(
        filters,
        { page, limit, sortBy, order, search },
        req.tenantId
      );
      res.json(successResponse(result.data, 'Tickets recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async stats(req, res, next) {
    try {
      const data = await ticketService.statsForTenant(req.tenantId);
      res.json(successResponse(data, 'Estadísticas de tickets'));
    } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try {
      const data = await ticketService.createBatchFromAdmin(req.body, req.tenantId, req.user);
      res.status(201).json(successResponse(data, 'Tickets creados exitosamente', 201));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await ticketService.findByIdForTenant(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Ticket recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async getByBatch(req, res, next) {
    try {
      const data = await ticketService.listByBatch(req.params.batchId, req.tenantId);
      res.json(successResponse(data, 'Batch recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async assign(req, res, next) {
    try {
      const { responsableId } = req.body;
      const data = await ticketService.assign(req.params.id, responsableId, req.tenantId, req.user);
      res.json(successResponse(data, 'Ticket asignado exitosamente'));
    } catch (err) { next(err); }
  }

  async addNote(req, res, next) {
    try {
      const data = await ticketService.addNote(req.params.id, req.body.note, req.tenantId, req.user);
      res.status(201).json(successResponse(data, 'Nota agregada exitosamente', 201));
    } catch (err) { next(err); }
  }

  async createWorkOrder(req, res, next) {
    try {
      const data = await ticketService.createWorkOrder(req.body, req.tenantId, req.user);
      res.status(201).json(successResponse(data, 'OT creada desde tickets exitosamente', 201));
    } catch (err) { next(err); }
  }

  async cancel(req, res, next) {
    try {
      const data = await ticketService.cancel(
        req.params.id,
        { closingObservation: req.body?.closingObservation },
        req.tenantId,
        req.user
      );
      res.json(successResponse(data, 'Ticket cancelado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const ticketController = new TicketController();
