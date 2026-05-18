import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class InventarioRepuestoService {
  async validatePlanAccess(tenantId) {
    // Inventory endpoints are feature-gated by plan to keep free tiers isolated.
    const tenant = await Tenant.findOne({ tenantId, isDeleted: false }).lean();
    if (!tenant) {
      throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    }

    const plan = String(tenant.plan || '').toLowerCase();
    if (!plan.includes('inventario')) {
      throw new ApiError(403, 'Inventario feature not included in your plan', 'PLAN_FORBIDDEN');
    }
  }

  async create(data, tenantId) {
    const t = tenantId || data.tenantId;
    requireTenant(t);
    await this.validatePlanAccess(t);
    const payload = { ...data, tenantId: t };
    const entity = await InventarioRepuesto.create(payload);
    logger.info('InventarioRepuesto creado: ' + entity._id);
    return entity;
  }

  async list(filters = {}, pagination = {}, tenantId) {
    const t = tenantId;
    requireTenant(t);
    await this.validatePlanAccess(t);

    const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
    const skip = (page - 1) * limit;
    const query = applyTenantFilter({ ...filters, isDeleted: false }, t);

    if (filters.stockBajo) {
      query.$expr = { $lt: ['$stockActual', '$stockMinimo'] };
    }

    if (search) {
      const rx = new RegExp(search, 'i');
      query.$or = [{ nombre: rx }, { referencia: rx }, { descripcion: rx }];
    }

    const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
    const [data, total] = await Promise.all([
      InventarioRepuesto.find(query).sort(sort).skip(skip).limit(limit).lean(),
      InventarioRepuesto.countDocuments(query),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  async getById(id, tenantId) {
    requireTenant(tenantId);
    await this.validatePlanAccess(tenantId);
    const entity = await InventarioRepuesto.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!entity) {
      throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id });
    }
    return entity;
  }

  async update(id, data, tenantId) {
    const t = tenantId || data.tenantId;
    requireTenant(t);
    await this.validatePlanAccess(t);
    const entity = await InventarioRepuesto.findOneAndUpdate(
      applyTenantFilter({ _id: id }, t),
      { $set: data },
      { new: true, runValidators: true }
    );
    if (!entity) {
      throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id });
    }
    logger.info('InventarioRepuesto actualizado: ' + id);
    return entity;
  }

  async delete(id, tenantId) {
    requireTenant(tenantId);
    await this.validatePlanAccess(tenantId);
    const entity = await InventarioRepuesto.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );
    if (!entity) {
      throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id });
    }
    logger.info('InventarioRepuesto eliminado (soft): ' + id);
  }
}

export const inventarioRepuestoService = new InventarioRepuestoService();
