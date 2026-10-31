import { requisicionService } from '../services/requisicion.service.js';
import { requisicionRecepcionService } from '../services/requisicionRecepcion.service.js';
import { requisicionApprovalService } from '../services/requisicionApproval.service.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { successResponse } from '../utils/apiResponse.util.js';

/** Binding only: req -> service -> res. The tenant always comes from the token chain (req.tenantId), never the body. */
const canManageAll = (req) => req.user?.role === 'superadmin'
  || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(PERMISSIONS.REQUISICIONES_MANAGE_ALL));

const canReceive = (req) => canManageAll(req)
  || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(PERMISSIONS.REQUISICIONES_RECEIVE));

const canRead = (req) => canManageAll(req)
  || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(PERMISSIONS.REQUISICIONES_READ));

const actorOf = (req) => ({
  userId: req.user?.userId,
  name: req.user?.fullName || req.user?.userName || req.user?.email,
  canManageAll: canManageAll(req),
});

export class RequisicionController {
  async create(req, res, next) {
    try {
      const data = await requisicionService.create(req.tenantId, req.user.userId, req.body, req.tenant?.capabilities);
      res.status(201).json(successResponse(data, 'Requisición creada exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await requisicionService.list(req.tenantId, req.user.userId, filters, { page, limit, sortBy, order }, { canReceive: canReceive(req), canManageAll: canManageAll(req) });
      res.json(successResponse(result.data, 'Requisiciones recuperadas exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await requisicionService.getById(req.tenantId, req.params.id);
      res.json(successResponse(data, 'Requisición recuperada exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await requisicionService.update(req.tenantId, req.user.userId, req.params.id, req.body, req.tenant?.capabilities, { canManageAll: canManageAll(req) });
      res.json(successResponse(data, 'Requisición actualizada exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await requisicionService.delete(req.tenantId, req.params.id, actorOf(req));
      res.json(successResponse(null, 'Requisición eliminada exitosamente'));
    } catch (err) { next(err); }
  }

  async enviar(req, res, next) {
    try {
      const data = await requisicionService.enviar(req.tenantId, req.params.id, actorOf(req), req.body);
      res.json(successResponse(data, 'Requisición enviada a aprobación'));
    } catch (err) { next(err); }
  }

  async cancelar(req, res, next) {
    try {
      const data = await requisicionService.cancelar(req.tenantId, req.params.id, actorOf(req), req.body);
      res.json(successResponse(data, 'Requisición cancelada'));
    } catch (err) { next(err); }
  }

  async cambiarEstado(req, res, next) {
    try {
      const data = await requisicionService.cambiarEstado(req.tenantId, req.params.id, actorOf(req), req.body);
      res.json(successResponse(data, 'Estado de la requisición actualizado'));
    } catch (err) { next(err); }
  }

  async registrarRecepcion(req, res, next) {
    try {
      const data = await requisicionRecepcionService.registrar(req.tenantId, req.params.id, actorOf(req), req.body, req.files || [], req.tenant?.capabilities);
      res.status(201).json(successResponse(data, 'Recepción registrada', 201));
    } catch (err) { next(err); }
  }

  async confirmarEntrega(req, res, next) {
    try {
      const data = await requisicionRecepcionService.confirmar(req.tenantId, req.params.id, req.params.recepcionId, { ...actorOf(req), canRead: canRead(req) }, req.body, req.tenant?.capabilities);
      res.json(successResponse(data, 'Entrega confirmada'));
    } catch (err) { next(err); }
  }

  async cerrarLinea(req, res, next) {
    try {
      const data = await requisicionRecepcionService.cerrarLinea(req.tenantId, req.params.id, req.params.lineaId, actorOf(req), req.body, req.tenant?.capabilities);
      res.json(successResponse(data, 'Línea cerrada'));
    } catch (err) { next(err); }
  }

  async aprobar(req, res, next) {
    try {
      const data = await requisicionApprovalService.approve(req.tenantId, req.params.id, actorOf(req), req.body);
      res.json(successResponse(data, 'Nivel de aprobación registrado'));
    } catch (err) { next(err); }
  }

  async reasignar(req, res, next) {
    try {
      const data = await requisicionApprovalService.reassign(req.tenantId, req.params.id, actorOf(req), req.body);
      res.json(successResponse(data, 'Aprobadores reasignados'));
    } catch (err) { next(err); }
  }

  async rechazar(req, res, next) {
    try {
      const data = await requisicionApprovalService.reject(req.tenantId, req.params.id, actorOf(req), req.body);
      res.json(successResponse(data, 'Requisición rechazada'));
    } catch (err) { next(err); }
  }
}

export const requisicionController = new RequisicionController();
