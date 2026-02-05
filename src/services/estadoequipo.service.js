import { EstadoEquipo } from '../models/estadoequipo.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export class EstadoEquipoService {
  async create(data) {
    try {
      const entity = await EstadoEquipo.create(data);
      logger.info('EstadoEquipo creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando estadoEquipo:', err);
      throw new ApiError(500, 'Error creando EstadoEquipo', 'CREATE_ERROR');
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
        EstadoEquipo.find(query).sort(sort).skip(skip).limit(limit).lean(),
        EstadoEquipo.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando estadoEquipos:', err);
      throw new ApiError(500, 'Error listando EstadoEquipos', 'LIST_ERROR');
    }
  }

  async getById(id) {
    try {
      const e = await EstadoEquipo.findById(id);
      if (!e) throw new ApiError(404, 'EstadoEquipo no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo estadoEquipo:', err);
      throw new ApiError(500, 'Error obteniendo EstadoEquipo', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await EstadoEquipo.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'EstadoEquipo no encontrado', 'NOT_FOUND', { id });
      logger.info('EstadoEquipo actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando estadoEquipo:', err);
      throw new ApiError(500, 'Error actualizando EstadoEquipo', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await EstadoEquipo.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'EstadoEquipo no encontrado', 'NOT_FOUND', { id });
      logger.info('EstadoEquipo eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando estadoEquipo:', err);
      throw new ApiError(500, 'Error eliminando EstadoEquipo', 'DELETE_ERROR');
    }
  }
}

export const estadoEquipoService = new EstadoEquipoService();
