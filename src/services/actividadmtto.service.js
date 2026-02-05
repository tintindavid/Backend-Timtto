import { ActividadMtto } from '../models/actividadmtto.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class ActividadMttoService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await ActividadMtto.create(data);
      logger.info('ActividadMtto creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando actividadMtto:', err);
      throw new ApiError(500, 'Error creando ActividadMtto', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ name: rx }, { description: rx }, { title: rx }, { email: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        ActividadMtto.find(query).sort(sort).skip(skip).limit(limit).lean(),
        ActividadMtto.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando actividadMttos:', err);
      throw new ApiError(500, 'Error listando ActividadMttos', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await ActividadMtto.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'ActividadMtto no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo actividadMtto:', err);
      throw new ApiError(500, 'Error obteniendo ActividadMtto', 'GET_ERROR');
    }
  }

  async update(id, data, tenantId) {
    try {
      const e = await ActividadMtto.findOneAndUpdate(applyTenantFilter({ _id: id }, tenantId), { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'ActividadMtto no encontrado', 'NOT_FOUND', { id });
      logger.info('ActividadMtto actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando actividadMtto:', err);
      throw new ApiError(500, 'Error actualizando ActividadMtto', 'UPDATE_ERROR');
    }
  }

  async delete(id, tenantId) {
    try {
      const e = await ActividadMtto.findOneAndUpdate(applyTenantFilter({ _id: id }, tenantId), { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'ActividadMtto no encontrado', 'NOT_FOUND', { id });
      logger.info('ActividadMtto eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando actividadMtto:', err);
      throw new ApiError(500, 'Error eliminando ActividadMtto', 'DELETE_ERROR');
    }
  }
}

export const actividadMttoService = new ActividadMttoService();
