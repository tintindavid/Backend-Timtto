import { Repuestos } from '../models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../models/repuestotrazabilidad.model.js';
import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';

export class RepuestosService {
  async createStatusTrace({ solicitudRepuestoId, estadoAnterior, estadoNuevo, comentarios, tenantId }) {
    if (!estadoNuevo) return;
    await RepuestoTrazabilidad.create({
      tenantId,
      SolicitudRepuestoId: solicitudRepuestoId,
      Status: estadoNuevo,
      EstadoActual: estadoNuevo,
      EstadoA: estadoNuevo,
      EstadoAnterior: estadoAnterior,
      EstadoNuevo: estadoNuevo,
      FechaHoraCambio: new Date(),
      Comentarios: comentarios || '',
    });
  }

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
      const { estado, clienteId, ...restFilters } = filters;
      const queryFilters = { ...restFilters, isDeleted: false };
      if (estado) queryFilters.EstadoSolicitud = estado;
      if (clienteId) queryFilters.ClienteId = clienteId;
      const query = applyTenantFilter(queryFilters, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ nombre: rx }, { observacion: rx }, { EstadoSolicitud: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Repuestos.find(query)
          .populate('ClienteId', 'Razonsocial')
          .populate('EquipoId', 'item Marca Modelo Serie Inventario')
          .populate('ResponsableSolicitud', 'firstName lastName email')
          .populate('OrdenId', 'Consecutivo _id')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
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
        if (Array.isArray(estado)) {
          baseFilter.EstadoSolicitud = { $nin: estado };
        } else if (estado) {
          baseFilter.EstadoSolicitud = estado;
        }
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
      const current = await Repuestos.findById(id).lean();
      const e = await Repuestos.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'Repuestos no encontrado', 'NOT_FOUND', { id });
      if (data.EstadoSolicitud && current?.EstadoSolicitud !== data.EstadoSolicitud) {
        await this.createStatusTrace({
          solicitudRepuestoId: e._id,
          estadoAnterior: current?.EstadoSolicitud,
          estadoNuevo: data.EstadoSolicitud,
          comentarios: data.ObservacionInstalacion || data.observacion,
          tenantId: e.tenantId,
        });
      }
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

  async createOtFromSolicitudes(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);

      const repuestoIds = Array.isArray(data.repuestoIds) ? data.repuestoIds : [];
      if (!repuestoIds.length) {
        throw new ApiError(400, 'Debe enviar al menos un repuesto', 'VALIDATION_ERROR');
      }

      const repuestos = await Repuestos.find(applyTenantFilter({ _id: { $in: repuestoIds } }, t)).lean();
      if (!repuestos.length) {
        throw new ApiError(404, 'No se encontraron repuestos seleccionados', 'NOT_FOUND');
      }

      const invalidEstado = repuestos.find((r) => (r.EstadoSolicitud || 'Solicitado') !== 'Solicitado');
      if (invalidEstado) {
        throw new ApiError(400, 'Solo se pueden procesar repuestos en estado Solicitado', 'INVALID_STATE');
      }

      const equipoIds = [...new Set(repuestos.map((r) => String(r.EquipoId)).filter(Boolean))];
      if (!equipoIds.length) {
        throw new ApiError(400, 'Los repuestos seleccionados no tienen equipo asociado', 'VALIDATION_ERROR');
      }

      let clienteId = repuestos.find((r) => r.ClienteId)?.ClienteId || null;
      if (!clienteId) {
        const reportIds = [...new Set(repuestos.map((r) => r.ReporteSolicitudId).filter(Boolean))];
        if (reportIds.length) {
          const reports = await Report.find(applyTenantFilter({ _id: { $in: reportIds } }, t)).select('ClienteId').lean();
          clienteId = reports.find((rp) => rp.ClienteId)?.ClienteId || null;
        }
      }
      if (!clienteId) {
        throw new ApiError(400, 'No fue posible inferir el cliente de los repuestos seleccionados', 'VALIDATION_ERROR');
      }

      const nextOtSeq = await getNextSequence(t, 'OT');
      const ot = await OT.create({
        tenantId: t,
        ClienteId: clienteId,
        Consecutivo: formatConsecutivo('OT', nextOtSeq, 6),
        EstadoOt: 'En Progreso',
        FechaCreacion: new Date(),
        Norden: `N${String(nextOtSeq).padStart(6, '0')}`,
        TipoServicio: 'Correctivo',
        OtPrioridad: data.OtPrioridad || 'Media',
        ResponsableId: data.ResponsableId,
      });

      // Create one report per unique equipment so OT execution is split by asset.
      const reportIds = [];
      for (const equipoId of equipoIds) {
        const eq = await EquipoItem.findById(equipoId)
          .populate('ItemId', 'Nombre')
          .populate('SedeId', 'nombreSede')
          .populate('Servicio', 'nombre')
          .lean();

        const nextReportSeq = await getNextSequence(t, 'REPORT');
        const reportConsec = formatConsecutivo('R', nextReportSeq, 6);
        const report = await Report.create({
          tenantId: t,
          Equipo: equipoId,
          ClienteId: clienteId,
          consecutivo: reportConsec,
          estado: 'Pendiente',
          FechaCreacion: new Date(),
          orden: ot._id,
          tipoMtto: 'Correctivo',
          equipoSnapshot: {
            ItemText: eq?.ItemId?.Nombre || eq?.item || '',
            Marca: eq?.Marca || '',
            Modelo: eq?.Modelo || '',
            Sede: eq?.SedeId?.nombreSede || '',
            Serie: eq?.Serie || '',
            Inventario: eq?.Inventario || '',
            Servicio: eq?.Servicio?.nombre || '',
            Ubicacion: eq?.Ubicacion || '',
            MesesMtto: Array.isArray(eq?.mesesMtto) ? eq.mesesMtto : (eq?.Meses ? [eq.Meses] : []),
          },
        });
        reportIds.push(report._id);
      }

      ot.reportes = reportIds;
      await ot.save();

      // Bulk state transition keeps the selected set consistent before trace writes.
      await Repuestos.updateMany(
        applyTenantFilter({ _id: { $in: repuestoIds } }, t),
        {
          $set: {
            OrdenId: ot._id,
            EstadoAnterior: 'Solicitado',
            EstadoSolicitud: 'En Proceso',
          }
        }
      );

      for (const repuesto of repuestos) {
        await this.createStatusTrace({
          solicitudRepuestoId: repuesto._id,
          estadoAnterior: repuesto.EstadoSolicitud || 'Solicitado',
          estadoNuevo: 'En Proceso',
          comentarios: `Automatic: created in OT ${String(ot._id)}`,
          tenantId: t,
        });
      }

      return {
        ot,
        repuestosActualizados: repuestos.length,
        equiposProcesados: equipoIds.length,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error creando OT desde solicitudes de repuestos:', err);
      throw new ApiError(500, 'Error creando OT desde solicitudes', 'CREATE_OT_FROM_SOLICITUDES_ERROR');
    }
  }
}

export const repuestosService = new RepuestosService();
