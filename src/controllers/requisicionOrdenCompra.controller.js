import { requisicionOrdenCompraService } from '../services/requisicionOrdenCompra.service.js';
import { requisicionOrdenCompraEnvioService } from '../services/requisicionOrdenCompraEnvio.service.js';
import { requisicionOrdenCompraPdfService } from '../services/requisicionOrdenCompraPdf.service.js';
import { requisicionEntregablesService } from '../services/requisicionEntregables.service.js';
import { userCanReadRequisiciones } from '../middlewares/requisicionReadAccess.middleware.js';
import { hasOrdenCompraPermission } from '../utils/requisicionQuoteVisibility.util.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * Binding only: req -> service -> res (E4 purchase order and deliverables). The tenant always comes from the token chain
 * (req.tenantId); the body can never set internal fields (the DTOs are strict allowlists).
 */
const canManageAll = (req) => req.user?.role === 'superadmin'
  || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(PERMISSIONS.REQUISICIONES_MANAGE_ALL));

const hasPerm = (req, p) => req.user?.role === 'superadmin' || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(p));

const actorOf = (req) => ({
  canApprovePo: hasPerm(req, PERMISSIONS.REQUISICIONES_APPROVE_PO),
  canIssuePo: hasPerm(req, PERMISSIONS.REQUISICIONES_ISSUE_PO),
  userId: req.user?.userId,
  name: req.user?.fullName || req.user?.userName || req.user?.email,
  canManageAll: canManageAll(req),
});

const caps = (req) => req.tenant?.capabilities;

export class RequisicionOrdenCompraController {
  async emitir(req, res, next) {
    try {
      const data = await requisicionOrdenCompraService.emitir(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Orden de compra emitida'));
    } catch (err) { next(err); }
  }

  async editar(req, res, next) {
    try {
      const data = await requisicionOrdenCompraService.editar(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Orden de compra actualizada'));
    } catch (err) { next(err); }
  }

  async aprobar(req, res, next) {
    try {
      const data = await requisicionOrdenCompraService.aprobar(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Decisión sobre la orden de compra registrada'));
    } catch (err) { next(err); }
  }

  async rechazar(req, res, next) {
    try {
      const data = await requisicionOrdenCompraService.rechazar(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Orden de compra rechazada'));
    } catch (err) { next(err); }
  }

  async enviar(req, res, next) {
    try {
      const data = await requisicionOrdenCompraEnvioService.enviar(req.tenantId, req.params.id, actorOf(req), caps(req));
      res.json(successResponse(data, 'Orden de compra enviada'));
    } catch (err) { next(err); }
  }

  async reenviar(req, res, next) {
    try {
      const data = await requisicionOrdenCompraEnvioService.reenviar(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Orden de compra reenviada'));
    } catch (err) { next(err); }
  }

  async pdf(req, res, next) {
    try {
      const access = {
        userId: req.user?.userId,
        canRead: userCanReadRequisiciones(req.user),
        canSeePrices: hasOrdenCompraPermission(req.user),
        canApprovePo: hasPerm(req, PERMISSIONS.REQUISICIONES_APPROVE_PO),
      };
      const { buffer, filename } = await requisicionOrdenCompraPdfService.generar(req.tenantId, req.params.id, access, caps(req));
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length,
        'Cache-Control': 'private, no-store',
      });
      res.status(200).send(buffer);
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------------------- deliverables

  async subirEntregables(req, res, next) {
    try {
      const data = await requisicionEntregablesService.subir(req.tenantId, req.params.id, actorOf(req), req.files || [], caps(req));
      res.status(201).json(successResponse(data, 'Entregables adjuntados', 201));
    } catch (err) { next(err); }
  }

  async marcarRecibidos(req, res, next) {
    try {
      const data = await requisicionEntregablesService.marcarRecibidos(req.tenantId, req.params.id, actorOf(req), caps(req));
      res.json(successResponse(data, 'Entregables marcados como recibidos'));
    } catch (err) { next(err); }
  }

  async revisarEntregables(req, res, next) {
    try {
      const data = await requisicionEntregablesService.revisar(req.tenantId, req.params.id, actorOf(req), caps(req));
      res.json(successResponse(data, 'Entregables en revisión'));
    } catch (err) { next(err); }
  }

  async aceptarEntregables(req, res, next) {
    try {
      const data = await requisicionEntregablesService.aceptar(req.tenantId, req.params.id, actorOf(req), caps(req));
      res.json(successResponse(data, 'Entregables aceptados'));
    } catch (err) { next(err); }
  }

  async devolverEntregables(req, res, next) {
    try {
      const data = await requisicionEntregablesService.devolver(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Entregables devueltos'));
    } catch (err) { next(err); }
  }
}

export const requisicionOrdenCompraController = new RequisicionOrdenCompraController();
