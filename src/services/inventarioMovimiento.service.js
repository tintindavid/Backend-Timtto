import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { InventarioMovimiento } from '../models/inventarioMovimiento.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

/** Signed stock delta of a movement. */
function toDelta(tipo, cantidad) {
  if (tipo === 'entrada') return cantidad;
  if (tipo === 'salida') return -cantidad;
  return cantidad; // ajuste: already a signed delta
}

export class InventarioMovimientoService {
  /**
   * Registers a stock movement and updates `stockActual` atomically.
   *
   * 1. `findOneAndUpdate` with `$inc` and a `$gte` guard when the delta is negative (stock never goes negative);
   * 2. insert the movement. Without a transaction session, a failed insert is compensated with the inverse `$inc`
   *    (the replica set is not guaranteed); with a session the transaction rolls both back.
   *
   * @param {string} tenantId
   * @param {{ itemId: string, tipo: 'entrada'|'salida'|'ajuste', cantidad: number, motivo?: string,
   *           referenciaTipo?: string, referenciaId?: string }} data
   * @param {string|null} usuarioId
   * @param {{ session?: import('mongoose').ClientSession|null }} [opts]
   * @returns {Promise<{ movimiento: object, item: object }>}
   */
  async create(tenantId, data, usuarioId = null, { session = null } = {}) {
    requireTenant(tenantId);
    const { itemId, tipo, motivo } = data;
    const cantidad = Number(data.cantidad);

    if (!Number.isFinite(cantidad) || cantidad === 0 || (tipo !== 'ajuste' && cantidad < 0)) {
      throw new ApiError(400, 'La cantidad del movimiento no es válida', 'INVALID_QUANTITY', { cantidad: data.cantidad });
    }
    if (tipo === 'ajuste' && !String(motivo || '').trim()) {
      throw new ApiError(400, 'El motivo es obligatorio en un ajuste', 'MOTIVO_REQUIRED');
    }

    const delta = toDelta(tipo, cantidad);
    const sessOpts = session ? { session } : {};
    const filter = applyTenantFilter({ _id: itemId }, tenantId);
    if (delta < 0) filter.stockActual = { $gte: -delta };

    const item = await InventarioRepuesto.findOneAndUpdate(
      filter,
      { $inc: { stockActual: delta } },
      { new: true, ...sessOpts },
    );
    if (!item) {
      const exists = await InventarioRepuesto.findOne(applyTenantFilter({ _id: itemId }, tenantId)).select('_id stockActual').lean();
      if (!exists) throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id: itemId });
      throw new ApiError(400, 'Stock insuficiente', 'INSUFFICIENT_STOCK', {
        itemId: String(itemId),
        required: -delta,
        available: exists.stockActual ?? 0,
      });
    }

    const stockResultante = item.stockActual;
    const doc = {
      tenantId,
      itemId: item._id,
      itemNombre: item.nombre,
      tipo,
      cantidad,
      stockAnterior: stockResultante - delta,
      stockResultante,
      motivo: motivo ? String(motivo).trim() : undefined,
      referenciaTipo: data.referenciaTipo || 'manual',
      referenciaId: data.referenciaId ? String(data.referenciaId) : undefined,
      usuarioId: usuarioId ? String(usuarioId) : undefined,
    };

    let movimiento;
    try {
      if (session) {
        [movimiento] = await InventarioMovimiento.create([doc], { session });
      } else {
        movimiento = await InventarioMovimiento.create(doc);
      }
    } catch (err) {
      if (!session) {
        try {
          await InventarioRepuesto.findOneAndUpdate(
            applyTenantFilter({ _id: item._id }, tenantId),
            { $inc: { stockActual: -delta } },
          );
        } catch (compErr) {
          logger.error('InventarioMovimiento: compensation failed, manual adjustment needed', {
            tenantId, itemId: String(item._id), delta, err: String(compErr),
          });
        }
      }
      throw err;
    }

    logger.info('InventarioMovimiento registrado', {
      tenantId, itemId: String(item._id), tipo, cantidad, usuarioId: doc.usuarioId, referenciaTipo: doc.referenciaTipo,
    });
    return { movimiento, item };
  }

  async list(tenantId, filters = {}, pagination = {}) {
    requireTenant(tenantId);
    const { page = 1, limit = 20 } = pagination;
    const query = applyTenantFilter({}, tenantId);
    if (filters.itemId) query.itemId = filters.itemId;
    if (filters.tipo) query.tipo = filters.tipo;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      InventarioMovimiento.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      InventarioMovimiento.countDocuments(query),
    ]);
    const pages = Math.ceil(total / limit);
    return {
      data,
      pagination: { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 },
    };
  }
}

export const inventarioMovimientoService = new InventarioMovimientoService();
