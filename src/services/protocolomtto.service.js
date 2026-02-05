import { ProtocoloMtto } from '../models/protocolomtto.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class ProtocoloMttoService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await ProtocoloMtto.create(data);
      logger.info('ProtocoloMtto creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando protocoloMtto:', err);
      throw new ApiError(500, 'Error creando ProtocoloMtto', 'CREATE_ERROR');
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
        ProtocoloMtto.find(query).sort(sort).skip(skip).limit(limit).lean(),
        ProtocoloMtto.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando protocoloMttos:', err);
      throw new ApiError(500, 'Error listando ProtocoloMttos', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await ProtocoloMtto.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'ProtocoloMtto no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo protocoloMtto:', err);
      throw new ApiError(500, 'Error obteniendo ProtocoloMtto', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await ProtocoloMtto.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'ProtocoloMtto no encontrado', 'NOT_FOUND', { id });
      logger.info('ProtocoloMtto actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando protocoloMtto:', err);
      throw new ApiError(500, 'Error actualizando ProtocoloMtto', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await ProtocoloMtto.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'ProtocoloMtto no encontrado', 'NOT_FOUND', { id });
      logger.info('ProtocoloMtto eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando protocoloMtto:', err);
      throw new ApiError(500, 'Error eliminando ProtocoloMtto', 'DELETE_ERROR');
    }
  }
}

export const protocoloMttoService = new ProtocoloMttoService();
