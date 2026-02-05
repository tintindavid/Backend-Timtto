import { Servicios } from '../models/servicios.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class ServiciosService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await Servicios.create(data);
      logger.info('Servicios creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando servicios:', err);
      throw new ApiError(500, 'Error creando Servicios', 'CREATE_ERROR');
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
        Servicios.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Servicios.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando servicioss:', err);
      throw new ApiError(500, 'Error listando Servicioss', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Servicios.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Servicios no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo servicios:', err);
      throw new ApiError(500, 'Error obteniendo Servicios', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await Servicios.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Servicios no encontrado', 'NOT_FOUND', { id });
      logger.info('Servicios actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando servicios:', err);
      throw new ApiError(500, 'Error actualizando Servicios', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await Servicios.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'Servicios no encontrado', 'NOT_FOUND', { id });
      logger.info('Servicios eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando servicios:', err);
      throw new ApiError(500, 'Error eliminando Servicios', 'DELETE_ERROR');
    }
  }
}

export const serviciosService = new ServiciosService();
