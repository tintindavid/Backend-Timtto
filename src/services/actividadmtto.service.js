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
        // Fixed latent bug (report-actividades-extra, design D7): these
        // fields never existed on ActividadMtto (name/description/title/
        // email were copy-pasted from an unrelated resource's service),
        // so `search` silently matched nothing. Real fields are Nombre and
        // Descripcion (see models/actividadmtto.model.js).
        const rx = new RegExp(search, 'i');
        query.$or = [{ Nombre: rx }, { Descripcion: rx }];
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

  /**
   * Busca actividades cuyo campo Nombre contenga el texto indicado (case-insensitive).
   * @param {string} nombre - Texto a buscar
   * @param {string} tenantId - Tenant del usuario autenticado
   * @returns {Promise<Array>} Lista de actividades coincidentes
   */
  async searchByName(nombre, tenantId) {
    try {
      requireTenant(tenantId);
      const query = applyTenantFilter(
        { isDeleted: false, Nombre: new RegExp(nombre, 'i') },
        tenantId
      );
      const data = await ActividadMtto.find(query).sort({ Nombre: 1 }).lean();
      logger.info(`Búsqueda de actividadMtto por nombre "${nombre}": ${data.length} resultados`);
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error buscando actividadMtto por nombre:', err);
      throw new ApiError(500, 'Error buscando ActividadMtto', 'SEARCH_ERROR');
    }
  }
}

export const actividadMttoService = new ActividadMttoService();
