import { Repuestos } from '../models/repuestos.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class RepuestosService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await Repuestos.create(data);
      logger.info('Repuestos creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando repuestos:', err);
      throw new ApiError(500, 'Error creando Repuestos', 'CREATE_ERROR');
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
        Repuestos.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Repuestos.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando repuestoss:', err);
      throw new ApiError(500, 'Error listando Repuestoss', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Repuestos.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Repuestos no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo repuestos:', err);
      throw new ApiError(500, 'Error obteniendo Repuestos', 'GET_ERROR');
    }
  }

  async listByEquipo(equipoId, estado, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const baseFilter = { EquipoId: equipoId, isDeleted: false };
      if (estado) baseFilter.EstadoSolicitud = estado;
      const query = applyTenantFilter(baseFilter, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ nombre: rx }, { observacion: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Repuestos.find(query)
        .populate('ResponsableSolicitud', 'firstName lastName email')
        .populate('ResponsableInstalacion', 'firstName lastName email')
        .populate('OrdenId', 'Consecutivo  _id')
        .sort(sort).skip(skip).limit(limit).lean(),
        Repuestos.countDocuments(query),
      ]);
      return {
        data,
        pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1 }
      };
    } catch (err) {
      logger.error('Error listando repuestos por equipo:', err);
      throw new ApiError(500, 'Error listando Repuestos por equipo', 'LIST_ERROR');
    }
  }

  async listByReport(reportId, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const baseFilter = { isDeleted: false, $or: [ { ReporteInstalacionId: reportId }, { ReporteSolicitudId: reportId } ] };
      const query = applyTenantFilter(baseFilter, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = query.$or || [];
        // keep existing $or for report fields, but also search in nombre/observacion
        query.$and = query.$and || [];
        query.$and.push({ $or: [{ nombre: rx }, { observacion: rx }] });
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Repuestos.find(query)
          .populate('ResponsableSolicitud', 'firstName lastName email')
          .populate('ResponsableInstalacion', 'firstName lastName email')
          .populate('OrdenId', 'Consecutivo  _id')
          .populate('EquipoId', 'item Marca Modelo Serie Inventario')
          .sort(sort).skip(skip).limit(limit).lean(),
        Repuestos.countDocuments(query),
      ]);
      return {
        data,
        pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1 }
      };
    } catch (err) {
      logger.error('Error listando repuestos por reporte:', err);
      throw new ApiError(500, 'Error listando Repuestos por reporte', 'LIST_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await Repuestos.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Repuestos no encontrado', 'NOT_FOUND', { id });
      logger.info('Repuestos actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando repuestos:', err);
      throw new ApiError(500, 'Error actualizando Repuestos', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await Repuestos.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'Repuestos no encontrado', 'NOT_FOUND', { id });
      logger.info('Repuestos eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando repuestos:', err);
      throw new ApiError(500, 'Error eliminando Repuestos', 'DELETE_ERROR');
    }
  }
}

export const repuestosService = new RepuestosService();
