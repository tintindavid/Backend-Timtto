import { Report } from '../models/report.model.js';
import { ProtocoloMtto } from '../models/protocolomtto.model.js';
import { OT } from '../models/ot.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class ReportService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      const entity = await Report.create(data);
      logger.info('Report creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando report:', err);
      throw new ApiError(500, 'Error creando Report', 'CREATE_ERROR');
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
        Report.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Report.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando reports:', err);
      throw new ApiError(500, 'Error listando Reports', 'LIST_ERROR');
    }
  }

  async listByOt(otId, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ orden: otId, isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ consecutivo: rx }, { estado: rx }, { 'equipoSnapshot.ItemText': rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Report.find(query)
          .populate('ResponsableMtto', 'firstName lastName ')
          .populate('ClienteId', 'Razonsocial')
          .populate({ path: 'Equipo', populate: { path: 'ItemId', select: 'Nombre ProtocoloId ProtocoloId' } })
          .populate('orden', 'Consecutivo')
          .sort(sort).skip(skip).limit(limit).lean(),
        Report.countDocuments(query),
      ]);

      // Attach protocolo data from ItemId.ProtocoloId when available
      await Promise.all(data.map(async (r) => {
        try {
          const protocoloId = r?.Equipo?.ItemId?.ProtocoloId || r?.Equipo?.ItemId?.protocoloId || null;
          if (protocoloId) {
            const p = await ProtocoloMtto.findById(protocoloId).lean();
            r.protocolo = p || null;
          } else {
            r.protocolo = null;
          }
        } catch (e) {
          r.protocolo = null;
        }
      }));
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando reports por OT:', err);
      throw new ApiError(500, 'Error listando Reports por OT', 'LIST_ERROR');
    }
  }

  /**
   * Obtiene reports filtrados por Equipo
   * @param {string} equipoId - ID del equipo
   * @param {object} pagination - Opciones de paginación
   * @param {string} tenantId - ID del tenant
   */
  async listByEquipo(equipoId, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ Equipo: equipoId, isDeleted: false }, tenantId);
      
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ consecutivo: rx }, { estado: rx }, { 'equipoSnapshot.ItemText': rx }];
      }
      
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Report.find(query)
          .populate('ResponsableMtto', 'firstName lastName')
          .populate('ClienteId')
          .populate({ path: 'Equipo', populate: { path: 'ItemId', select: 'Nombre ProtocoloId' } })
          .populate('orden', 'Consecutivo')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Report.countDocuments(query),
      ]);

      // Attach protocolo data from ItemId.ProtocoloId when available
      await Promise.all(data.map(async (r) => {
        try {
          const protocoloId = r?.Equipo?.ItemId?.ProtocoloId || r?.Equipo?.ItemId?.protocoloId || null;
          if (protocoloId) {
            const p = await ProtocoloMtto.findById(protocoloId).lean();
            r.protocolo = p || null;
          } else {
            r.protocolo = null;
          }
        } catch (e) {
          r.protocolo = null;
        }
      }));

      logger.info(`Reports encontrados para EquipoId ${equipoId}: ${total}`);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando reports por Equipo:', err);
      throw new ApiError(500, 'Error listando Reports por Equipo', 'LIST_BY_EQUIPO_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Report.findOne(applyTenantFilter({ _id: id }, tenantId))
        .populate('ClienteId', 'Razonsocial')
        .populate({ path: 'Equipo', populate: { path: 'ItemId', select: 'Nombre ProtocoloId ProtocoloId' } })
        .populate('orden', 'Consecutivo')
        .lean();
      if (!e) throw new ApiError(404, 'Report no encontrado', 'NOT_FOUND', { id });
      try {
        const protocoloId = e?.Equipo?.ItemId?.ProtocoloId || e?.Equipo?.ItemId?.protocoloId || null;
        e.protocolo = protocoloId ? await ProtocoloMtto.findById(protocoloId).lean() : null;
      } catch (pe) {
        e.protocolo = null;
      }
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo report:', err);
      throw new ApiError(500, 'Error obteniendo Report', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await Report.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Report no encontrado', 'NOT_FOUND', { id });
      logger.info('Report actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando report:', err);
      throw new ApiError(500, 'Error actualizando Report', 'UPDATE_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await Report.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'Report no encontrado', 'NOT_FOUND', { id });
      logger.info('Report eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando report:', err);
      throw new ApiError(500, 'Error eliminando Report', 'DELETE_ERROR');
    }
  }

  async procesar(reporteId, data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);

      logger.info('data report: ',{ data });
      // Sanitize incoming payload: only allow fields that exist in schema and map actividadesRealizadas
      const allowed = {};
      if (typeof data.estado !== 'undefined') allowed.estado = data.estado;
      if (typeof data.fechaProcesado !== 'undefined') allowed.fechaProcesado = data.fechaProcesado;
      if (typeof data.observacion !== 'undefined') allowed.observacion = data.observacion;
      if (typeof data.CausaEncontrada !== 'undefined') allowed.CausaEncontrada = data.CausaEncontrada;
      if (typeof data.ResponsableMtto !== 'undefined') allowed.ResponsableMtto = data.ResponsableMtto;
      if (typeof data.fallaReportada !== 'undefined') allowed.fallaReportada = data.fallaReportada;
      if (typeof data.diagnostico !== 'undefined') allowed.diagnostico = data.diagnostico;
      if (typeof data.accionTomada !== 'undefined') allowed.accionTomada = data.accionTomada;
      if (typeof data.observacionEstadoFinal !== 'undefined') allowed.observacionEstadoFinal = data.observacionEstadoFinal;
      if (typeof data.estadoOperativo !== 'undefined') allowed.estadoOperativo = data.estadoOperativo;

      if (Array.isArray(data.actividadesRealizadas)) {
        // Map and strip any _id or unexpected fields to avoid cast errors
        allowed.actividadesRealizadas = data.actividadesRealizadas.map((it) => ({
          actividadProtocoloId: it.actividad || it.actividadProtocoloId || it.actividadId || '',
          descripcion: it.descripcion || it.descripcion || '',
          realizado: Boolean(it.realizada),
          fecha: it.fecha || null,
          observaciones: it.observaciones || '',
        }));
      }

      // Update the report with sanitized data
      const updated = await Report.findOneAndUpdate(applyTenantFilter({ _id: reporteId }, t), { $set: allowed }, { new: true, runValidators: true });
      if (!updated) throw new ApiError(404, 'Report no encontrado', 'NOT_FOUND', { id: reporteId });

      // If the report belongs to an OT, recompute its progress/status
      const ordenId = updated.orden;
      let otUpdated = null;
      if (ordenId) {
        const baseQuery = applyTenantFilter({ orden: ordenId, isDeleted: false }, t);
        const total = await Report.countDocuments(baseQuery);
        const closedQuery = applyTenantFilter({ orden: ordenId, isDeleted: false, estado: 'Cerrado' }, t);
        const closed = await Report.countDocuments(closedQuery);

        const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
        let nuevoEstado = 'Pendiente';
        if (closed === total && total > 0) nuevoEstado = 'Cerrado';
        else if (closed > 0) nuevoEstado = 'En Progreso';

        otUpdated = await OT.findOneAndUpdate(applyTenantFilter({ _id: ordenId }, t), { $set: { Avance: avance, EstadoOt: nuevoEstado } }, { new: true });
      }

      logger.info('Report procesado: ' + reporteId);
      return { report: updated, ot: otUpdated };
    } catch (err) {
      logger.error('Error procesando report:', err);
      throw new ApiError(500, 'Error procesando Report', 'PROCESS_ERROR');
    }
  }
}

export const reportService = new ReportService();
