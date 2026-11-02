import { requisicionLicitacionService } from '../services/requisicionLicitacion.service.js';
import { requisicionLicitacionCotizacionService } from '../services/requisicionLicitacionCotizacion.service.js';
import { requisicionGanadorService } from '../services/requisicionGanador.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * Binding only: req -> service -> res (E3 tendering). The tenant always comes from the token chain (req.tenantId); the
 * body can never set internal fields (the DTOs are strict allowlists).
 */
const actorOf = (req) => ({
  userId: req.user?.userId,
  name: req.user?.fullName || req.user?.userName || req.user?.email,
});

const caps = (req) => req.tenant?.capabilities;

export class RequisicionLicitacionController {
  async asignarProveedor(req, res, next) {
    try {
      const data = await requisicionLicitacionService.asignarProveedor(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.status(201).json(successResponse(data, 'Proveedor asignado', 201));
    } catch (err) { next(err); }
  }

  async quitarProveedor(req, res, next) {
    try {
      const data = await requisicionLicitacionService.quitarProveedor(req.tenantId, req.params.id, req.params.paId, actorOf(req), caps(req));
      res.json(successResponse(data, 'Proveedor quitado'));
    } catch (err) { next(err); }
  }

  async abrir(req, res, next) {
    try {
      const data = await requisicionLicitacionService.abrir(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Licitación abierta'));
    } catch (err) { next(err); }
  }

  async ampliarFechaLimite(req, res, next) {
    try {
      const data = await requisicionLicitacionService.ampliarFechaLimite(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Fecha límite ampliada'));
    } catch (err) { next(err); }
  }

  async reenviar(req, res, next) {
    try {
      const data = await requisicionLicitacionService.reenviar(req.tenantId, req.params.id, req.params.paId, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Invitación reenviada'));
    } catch (err) { next(err); }
  }

  async registrarCotizacion(req, res, next) {
    try {
      const data = await requisicionLicitacionCotizacionService.registrarCotizacion(req.tenantId, req.params.id, req.params.paId, actorOf(req), req.body, req.file || null, caps(req));
      res.status(201).json(successResponse(data, 'Cotización registrada', 201));
    } catch (err) { next(err); }
  }

  async cerrar(req, res, next) {
    try {
      const data = await requisicionLicitacionCotizacionService.cerrar(req.tenantId, req.params.id, actorOf(req), caps(req));
      res.json(successResponse(data, 'Cotizaciones cerradas'));
    } catch (err) { next(err); }
  }

  async comparativo(req, res, next) {
    try {
      const data = await requisicionLicitacionCotizacionService.comparativo(req.tenantId, req.params.id);
      res.json(successResponse(data, 'Comparativo recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async seleccionarGanador(req, res, next) {
    try {
      const data = await requisicionGanadorService.seleccionarGanador(req.tenantId, req.params.id, req.params.paId, actorOf(req), caps(req));
      res.json(successResponse(data, 'Proveedor seleccionado'));
    } catch (err) { next(err); }
  }

  async compraDirecta(req, res, next) {
    try {
      const data = await requisicionGanadorService.compraDirecta(req.tenantId, req.params.id, actorOf(req), req.body, caps(req));
      res.json(successResponse(data, 'Compra directa registrada'));
    } catch (err) { next(err); }
  }
}

export const requisicionLicitacionController = new RequisicionLicitacionController();
