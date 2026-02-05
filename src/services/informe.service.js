import { Informe } from '../models/informe.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class InformeService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await Informe.create(data);
      logger.info('Informe creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando informe:', err);
      throw new ApiError(500, 'Error creando Informe', 'CREATE_ERROR');
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
        Informe.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Informe.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando informes:', err);
      throw new ApiError(500, 'Error listando Informes', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Informe.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Informe no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo informe:', err);
      throw new ApiError(500, 'Error obteniendo Informe', 'GET_ERROR');
    }
  }

  async update(id, data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      const e = await Informe.findOneAndUpdate(applyTenantFilter({ _id: id }, t), { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Informe no encontrado', 'NOT_FOUND', { id });
      logger.info('Informe actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando informe:', err);
      throw new ApiError(500, 'Error actualizando Informe', 'UPDATE_ERROR');
    }
  }

  async delete(id, tenantId) {
    try {
      requireTenant(tenantId);
      const e = await Informe.findOneAndUpdate(applyTenantFilter({ _id: id }, tenantId), { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'Informe no encontrado', 'NOT_FOUND', { id });
      logger.info('Informe eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando informe:', err);
      throw new ApiError(500, 'Error eliminando Informe', 'DELETE_ERROR');
    }
  }
}

export const informeService = new InformeService();
