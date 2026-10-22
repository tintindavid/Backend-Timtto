import { inventarioMovimientoService } from '../services/inventarioMovimiento.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class InventarioMovimientoController {
  async create(req, res, next) {
    try {
      const { itemId, tipo, cantidad, motivo } = req.body;
      const { movimiento, item } = await inventarioMovimientoService.create(
        req.tenantId,
        { itemId, tipo, cantidad, motivo },
        req.user?.userId,
      );
      const data = { ...movimiento.toJSON(), item: { _id: item._id, nombre: item.nombre, stockActual: item.stockActual } };
      res.status(201).json(successResponse(data, 'Movimiento registrado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, ...filters } = req.query;
      const result = await inventarioMovimientoService.list(req.tenantId, filters, { page, limit });
      res.json(successResponse(result.data, 'Movimientos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }
}

export const inventarioMovimientoController = new InventarioMovimientoController();
