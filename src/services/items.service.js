import { Items } from '../models/items.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';

export class ItemsService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await Items.create(data);
      logger.info('Items creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando items:', err);
      throw new ApiError(500, 'Error creando Items', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(escapeRegex(search), 'i');
        query.$or = [{ Nombre: rx }, { Observacion: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Items.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
        Items.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando itemss:', err);
      throw new ApiError(500, 'Error listando Itemss', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Items.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Items no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo items:', err);
      throw new ApiError(500, 'Error obteniendo Items', 'GET_ERROR');
    }
  }

  async update(id, data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      const e = await Items.findOneAndUpdate(applyTenantFilter({ _id: id }, t), { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Items no encontrado', 'NOT_FOUND', { id });
      logger.info('Items actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando items:', err);
      throw new ApiError(500, 'Error actualizando Items', 'UPDATE_ERROR');
    }
  }

  async delete(id, tenantId) {
    try {
      requireTenant(tenantId);
      const e = await Items.findOneAndUpdate(applyTenantFilter({ _id: id }, tenantId), { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'Items no encontrado', 'NOT_FOUND', { id });
      logger.info('Items eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando items:', err);
      throw new ApiError(500, 'Error eliminando Items', 'DELETE_ERROR');
    }
  }
}

export const itemsService = new ItemsService();
