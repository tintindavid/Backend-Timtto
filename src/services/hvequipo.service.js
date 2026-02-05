import { HVEquipo } from '../models/hvequipo.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export class HVEquipoService {
  async create(data) {
    try {
      const entity = await HVEquipo.create(data);
      logger.info('HVEquipo creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando hVEquipo:', err);
      throw new ApiError(500, 'Error creando HVEquipo', 'CREATE_ERROR');
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
        HVEquipo.find(query).sort(sort).skip(skip).limit(limit).lean(),
        HVEquipo.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando hVEquipos:', err);
      throw new ApiError(500, 'Error listando HVEquipos', 'LIST_ERROR');
    }
  }

  async getById(id) {
    try {
      const e = await HVEquipo.findById(id);
      if (!e) throw new ApiError(404, 'HVEquipo no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo hVEquipo:', err);
      throw new ApiError(500, 'Error obteniendo HVEquipo', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await HVEquipo.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'HVEquipo no encontrado', 'NOT_FOUND', { id });
      logger.info('HVEquipo actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando hVEquipo:', err);
      throw new ApiError(500, 'Error actualizando HVEquipo', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await HVEquipo.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'HVEquipo no encontrado', 'NOT_FOUND', { id });
      logger.info('HVEquipo eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando hVEquipo:', err);
      throw new ApiError(500, 'Error eliminando HVEquipo', 'DELETE_ERROR');
    }
  }
}

export const hVEquipoService = new HVEquipoService();
