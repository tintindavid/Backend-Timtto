import { PresupuestoArea } from '../models/presupuestoArea.model.js';
import { Area } from '../models/area.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { stripEsSistema, assertNotSistema, assertSistemaLocked } from '../utils/registroSistema.util.js';
import { buildPagination } from '../utils/pagination.util.js';
import { roundMoney } from '../utils/money.util.js';
import { getTenantCurrency } from '../utils/tenantCurrency.util.js';

export class PresupuestoAreaService {
  async create(tenantId, data) {
    requireTenant(tenantId);
    const { tenantId: _t, moneda: _m, ...clean } = stripEsSistema(data);
    const area = await Area.findOne(applyTenantFilter({ _id: clean.areaId }, tenantId)).select('_id').lean();
    if (!area) throw new ApiError(400, 'El área no existe en la organización', 'AREA_INVALIDA', { areaId: clean.areaId });
    const dup = await PresupuestoArea.findOne(applyTenantFilter({ areaId: clean.areaId, periodo: clean.periodo }, tenantId)).select('_id').lean();
    if (dup) throw new ApiError(409, 'Ya existe un presupuesto para esa área y período', 'DUPLICATE_PRESUPUESTO', { areaId: clean.areaId, periodo: clean.periodo });
    const moneda = await getTenantCurrency(tenantId);
    try {
      const presupuesto = await PresupuestoArea.create({ ...clean, monto: roundMoney(clean.monto), moneda, tenantId });
      logger.info('PresupuestoArea creado: ' + presupuesto._id);
      return presupuesto;
    } catch (err) {
      if (err && err.code === 11000) {
        throw new ApiError(409, 'Ya existe un presupuesto para esa área y período', 'DUPLICATE_PRESUPUESTO');
      }
      throw err;
    }
  }

  async list(tenantId, filters = {}, pagination = {}) {
    requireTenant(tenantId);
    const { page = 1, limit = 10 } = pagination;
    const query = applyTenantFilter({}, tenantId);
    if (filters.areaId) query.areaId = filters.areaId;
    if (filters.periodo) query.periodo = filters.periodo;
    const [data, total] = await Promise.all([
      PresupuestoArea.find(query).sort({ periodo: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PresupuestoArea.countDocuments({ ...query, isDeleted: { $ne: true } }),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  }

  async getById(tenantId, id) {
    requireTenant(tenantId);
    const presupuesto = await PresupuestoArea.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!presupuesto) throw new ApiError(404, 'Presupuesto no encontrado', 'PRESUPUESTO_NOT_FOUND', { id });
    return presupuesto;
  }

  async update(tenantId, id, data) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = stripEsSistema(data);
    const current = await PresupuestoArea.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!current) throw new ApiError(404, 'Presupuesto no encontrado', 'PRESUPUESTO_NOT_FOUND', { id });
    assertSistemaLocked(current, clean, ['areaId', 'periodo']);
    if (clean.monto !== undefined) clean.monto = roundMoney(clean.monto);
    const presupuesto = await PresupuestoArea.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: clean },
      { new: true, runValidators: true },
    );
    if (!presupuesto) throw new ApiError(404, 'Presupuesto no encontrado', 'PRESUPUESTO_NOT_FOUND', { id });
    logger.info('PresupuestoArea actualizado: ' + id);
    return presupuesto;
  }

  async delete(tenantId, id) {
    requireTenant(tenantId);
    const current = await PresupuestoArea.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!current) throw new ApiError(404, 'Presupuesto no encontrado', 'PRESUPUESTO_NOT_FOUND', { id });
    assertNotSistema(current);
    const presupuesto = await PresupuestoArea.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
    if (!presupuesto) throw new ApiError(404, 'Presupuesto no encontrado', 'PRESUPUESTO_NOT_FOUND', { id });
    logger.info('PresupuestoArea eliminado (soft): ' + id);
  }
}

export const presupuestoAreaService = new PresupuestoAreaService();
