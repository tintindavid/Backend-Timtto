import { CustomerNoUsar } from '../models/customernousar.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export class CustomerNoUsarService {
  async create(data) {
    try {
      const entity = await CustomerNoUsar.create(data);
      logger.info('CustomerNoUsar creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando customerNoUsar:', err);
      throw new ApiError(500, 'Error creando CustomerNoUsar', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = { ...filters, isDeleted: false };
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ name: rx }, { description: rx }, { title: rx }, { email: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        CustomerNoUsar.find(query).sort(sort).skip(skip).limit(limit).lean(),
        CustomerNoUsar.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando customerNoUsars:', err);
      throw new ApiError(500, 'Error listando CustomerNoUsars', 'LIST_ERROR');
    }
  }

  async getById(id) {
    try {
      const e = await CustomerNoUsar.findById(id);
      if (!e) throw new ApiError(404, 'CustomerNoUsar no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo customerNoUsar:', err);
      throw new ApiError(500, 'Error obteniendo CustomerNoUsar', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await CustomerNoUsar.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'CustomerNoUsar no encontrado', 'NOT_FOUND', { id });
      logger.info('CustomerNoUsar actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando customerNoUsar:', err);
      throw new ApiError(500, 'Error actualizando CustomerNoUsar', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await CustomerNoUsar.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'CustomerNoUsar no encontrado', 'NOT_FOUND', { id });
      logger.info('CustomerNoUsar eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando customerNoUsar:', err);
      throw new ApiError(500, 'Error eliminando CustomerNoUsar', 'DELETE_ERROR');
    }
  }
}

export const customerNoUsarService = new CustomerNoUsarService();
