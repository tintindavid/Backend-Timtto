import { RepuestoTrazabilidad } from '../models/repuestotrazabilidad.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class RepuestoTrazabilidadService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await RepuestoTrazabilidad.create(data);
      logger.info('RepuestoTrazabilidad creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando repuestoTrazabilidad:', err);
      throw new ApiError(500, 'Error creando RepuestoTrazabilidad', 'CREATE_ERROR');
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
        RepuestoTrazabilidad.find(query).sort(sort).skip(skip).limit(limit).lean(),
        RepuestoTrazabilidad.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando repuestoTrazabilidads:', err);
      throw new ApiError(500, 'Error listando RepuestoTrazabilidads', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await RepuestoTrazabilidad.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'RepuestoTrazabilidad no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo repuestoTrazabilidad:', err);
      throw new ApiError(500, 'Error obteniendo RepuestoTrazabilidad', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await RepuestoTrazabilidad.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'RepuestoTrazabilidad no encontrado', 'NOT_FOUND', { id });
      logger.info('RepuestoTrazabilidad actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando repuestoTrazabilidad:', err);
      throw new ApiError(500, 'Error actualizando RepuestoTrazabilidad', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await RepuestoTrazabilidad.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'RepuestoTrazabilidad no encontrado', 'NOT_FOUND', { id });
      logger.info('RepuestoTrazabilidad eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando repuestoTrazabilidad:', err);
      throw new ApiError(500, 'Error eliminando RepuestoTrazabilidad', 'DELETE_ERROR');
    }
  }
}

export const repuestoTrazabilidadService = new RepuestoTrazabilidadService();
