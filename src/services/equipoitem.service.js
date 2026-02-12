import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { Report } from '../models/report.model.js';
import { applyTenantFilter } from '../utils/tenant.util.js';

export class EquipoItemService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await EquipoItem.create(data);
      logger.info('EquipoItem creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando equipoItem:', err);
      throw new ApiError(500, 'Error creando EquipoItem', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 500, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = { ...filters, isDeleted: false };
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ name: rx }, { description: rx }, { title: rx }, { email: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        EquipoItem.find(query)
        .populate('ItemId', 'Nombre')
        .populate('Servicio', 'nombre')
        .populate('SedeId', 'nombreSede')
        .sort(sort).skip(skip).limit(limit).lean(),
        EquipoItem.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando equipoItems:', err);
      throw new ApiError(500, 'Error listando EquipoItems', 'LIST_ERROR');
    }
  }

  async getById(id) {
    try {
      const e = await EquipoItem.findById(id);
      if (!e) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo equipoItem:', err);
      throw new ApiError(500, 'Error obteniendo EquipoItem', 'GET_ERROR');
    }
  }

  /**
   * Obtiene un EquipoItem por ID con todas las referencias populadas
   * @param {string} id - ID del equipo
   * @param {string} tenantId - ID del tenant
   */
  async getByIdPopulated(id, tenantId) {
    try {
      const query = applyTenantFilter({ _id: id, isDeleted: false }, tenantId);
      const e = await EquipoItem.findOne(query)
        .populate('ClienteId', 'Razonsocial Nit Direccion Ciudad Telefono Email')
        .populate('ItemId', 'Nombre Descripcion Categoria')
        .populate('SedeId', 'nombreSede Direccion Ciudad Telefono')
        .populate('Servicio', 'nombre descripcion')
        .lean();
      
      if (!e) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
      logger.info(`EquipoItem populado recuperado: ${id}`);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo equipoItem populado:', err);
      throw new ApiError(500, 'Error obteniendo EquipoItem populado', 'GET_POPULATED_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await EquipoItem.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
      logger.info('EquipoItem actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando equipoItem:', err);
      throw new ApiError(500, 'Error actualizando EquipoItem', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await EquipoItem.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
      logger.info('EquipoItem eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando equipoItem:', err);
      throw new ApiError(500, 'Error eliminando EquipoItem', 'DELETE_ERROR');
    }
  }

  async updateAndSnapshot(equipoId, payload, tenantId) {
    try {
      const t = tenantId || payload.tenantId;
      requireTenant(t);

      // Update equipo fields (only fields provided in payload)
      const updateFields = {};
      ['Marca','Serie','Inventario','Ubicacion','Modelo','mesesMtto','Servicio','SedeId','ItemId'].forEach((k) => {
        if (typeof payload[k] !== 'undefined') updateFields[k] = payload[k];
      });

      logger.info('Updating EquipoItem with fields:');  
      logger.info(equipoId);
      const equipo = await EquipoItem.findByIdAndUpdate(equipoId, { $set: updateFields }, { new: true, runValidators: true })
        .populate('ItemId', 'Nombre ProtocoloId')
        .populate('SedeId', 'nombreSede')
        .populate('Servicio', 'nombre')
        .lean();

        logger.info(`EquipoItem after update: ${JSON.stringify(equipo, null, 2)}`);
      if (!equipo) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id: equipoId });

      // Build equipoSnapshot from updated equipo
      const equipoSnapshot = {
        ItemText: equipo?.ItemId?.Nombre || equipo.item || '',
        Marca: equipo?.Marca || '',
        Modelo: equipo?.Modelo || '',
        Sede: equipo?.SedeId?.nombreSede || '',
        Serie: equipo?.Serie || '',
        Inventario: equipo?.Inventario || '',
        Servicio: equipo?.Servicio?.nombre || '',
        Ubicacion: equipo?.Ubicacion || '',
        MesesMtto: Array.isArray(equipo?.mesesMtto) ? equipo.mesesMtto : (equipo?.Meses ? [equipo.Meses] : []),
      };

      // Update report snapshot if reportId provided
      let updatedReport = null;
      if (payload.reportId) {
        updatedReport = await Report.findOneAndUpdate(applyTenantFilter({ _id: payload.reportId }, t), { $set: { equipoSnapshot } }, { new: true });
        if (!updatedReport) throw new ApiError(404, 'Report no encontrado', 'NOT_FOUND', { id: payload.reportId });
      }

      logger.info('Equipo actualizado y snapshot aplicado al Report: ' + equipoId);
      return { equipo, report: updatedReport };
    } catch (err) {
      logger.error('Error actualizando equipo y snapshot:', err);
      throw new ApiError(500, 'Error actualizando Equipo y snapshot', 'UPDATE_SNAPSHOT_ERROR');
    }
  }
}

export const equipoItemService = new EquipoItemService();
