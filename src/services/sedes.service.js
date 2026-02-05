import { Sedes } from '../models/sedes.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class SedesService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await Sedes.create(data);
      logger.info('Sedes creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando sedes:', err);
      throw new ApiError(500, 'Error creando Sedes', 'CREATE_ERROR');
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
        Sedes.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Sedes.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando sedess:', err);
      throw new ApiError(500, 'Error listando Sedess', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Sedes.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Sedes no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo sedes:', err);
      throw new ApiError(500, 'Error obteniendo Sedes', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await Sedes.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Sedes no encontrado', 'NOT_FOUND', { id });
      logger.info('Sedes actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando sedes:', err);
      throw new ApiError(500, 'Error actualizando Sedes', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await Sedes.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'Sedes no encontrado', 'NOT_FOUND', { id });
      logger.info('Sedes eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando sedes:', err);
      throw new ApiError(500, 'Error eliminando Sedes', 'DELETE_ERROR');
    }
  }
}

export const sedesService = new SedesService();
