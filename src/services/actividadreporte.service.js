import { ActividadReporte } from '../models/actividadreporte.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class ActividadReporteService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await ActividadReporte.create(data);
      logger.info('ActividadReporte creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando actividadReporte:', err);
      throw new ApiError(500, 'Error creando ActividadReporte', 'CREATE_ERROR');
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
        ActividadReporte.find(query).sort(sort).skip(skip).limit(limit).lean(),
        ActividadReporte.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando actividadReportes:', err);
      throw new ApiError(500, 'Error listando ActividadReportes', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await ActividadReporte.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'ActividadReporte no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo actividadReporte:', err);
      throw new ApiError(500, 'Error obteniendo ActividadReporte', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await ActividadReporte.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'ActividadReporte no encontrado', 'NOT_FOUND', { id });
      logger.info('ActividadReporte actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando actividadReporte:', err);
      throw new ApiError(500, 'Error actualizando ActividadReporte', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await ActividadReporte.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'ActividadReporte no encontrado', 'NOT_FOUND', { id });
      logger.info('ActividadReporte eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando actividadReporte:', err);
      throw new ApiError(500, 'Error eliminando ActividadReporte', 'DELETE_ERROR');
    }
  }
}

export const actividadReporteService = new ActividadReporteService();
