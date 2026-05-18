import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../models/repuestotrazabilidad.model.js';
import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';

export class OTService {
  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;
      // Map possible front-end field names to internal ones
      if (data.customerId && !data.ClienteId) data.ClienteId = data.customerId;
      if (data.tipoServicio && !data.TipoServicio) data.TipoServicio = data.tipoServicio;
      if (data.urgencia && !data.OtPrioridad) data.OtPrioridad = data.urgencia;
      if (!data.equipos && Array.isArray(data.equiposSeleccionados)) data.equipos = data.equiposSeleccionados;

      // Extract equipos array from payload (IDs)
      const equipos = Array.isArray(data.equipos) ? data.equipos.slice() : [];
      delete data.equipos;
      delete data.equiposSeleccionados;

      // Generate OT consecutivo
      const nextOtSeq = await getNextSequence(t, 'OT');
      data.Consecutivo = formatConsecutivo('OT', nextOtSeq, 6);

      // Ensure required fields have sensible defaults
      data.FechaCreacion = data.FechaCreacion ? new Date(data.FechaCreacion) : new Date();
      if (!data.EstadoOt) data.EstadoOt = 'Pendiente';
      if (!data.Norden) data.Norden = `N${String(nextOtSeq).padStart(6, '0')}`;

      // Create OT without reports
      const entity = await OT.create(data);

      // For each equipo, create a Report and link to OT
      const reportIds = [];
      for (const equipo of equipos) {
        // Load equipoItem to build snapshot
        const eq = await EquipoItem.findById(equipo)
          .populate('ItemId', 'Nombre')
          .populate('SedeId', 'nombreSede')
          .populate('Servicio', 'nombre')
          .lean();

        const nextReportSeq = await getNextSequence(t, 'REPORT');
        const reportConsec = formatConsecutivo('R', nextReportSeq, 6);

        const equipoSnapshot = {
          ItemText: eq?.ItemId?.Nombre || eq?.item || '',
          Marca: eq?.Marca || '',
          Modelo: eq?.Modelo || '',
          Sede: eq?.SedeId?.nombreSede || '',
          Serie: eq?.Serie || '',
          Inventario: eq?.Inventario || '',
          Servicio: eq?.Servicio?.nombre || '',
          Ubicacion: eq?.Ubicacion || '',
          MesesMtto: Array.isArray(eq?.mesesMtto) ? eq.mesesMtto : (eq?.Meses ? [eq.Meses] : []),
          protocoloMtto: eq?.ProtocoloId || '',
        };

        const reportPayload = {
          tenantId: t,
          Equipo: equipo,
          ClienteId: data.ClienteId || null,
          consecutivo: reportConsec,
          estado: 'Pendiente',
          FechaCreacion: new Date(),
          orden: entity._id,
          equipoSnapshot,
          tipoMtto: entity.TipoServicio || 'Preventivo',
        };

        const r = await Report.create(reportPayload);
        reportIds.push(r._id);
      }

      if (reportIds.length) {
        entity.reportes = reportIds;
        await entity.save();
      }

      logger.info('OT creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando oT:', err);
      throw new ApiError(500, 'Error creando OT', 'CREATE_ERROR');
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
        OT.find(query)
        .populate('ClienteId', 'Razonsocial Ciudad Departamento Email Nit Direccion _id')
        .sort(sort).skip(skip).limit(limit).lean(),
        OT.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando oTs:', err);
      throw new ApiError(500, 'Error listando OTs', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await OT.findOne(applyTenantFilter({ _id: id }, tenantId))
      .populate('ClienteId', 'Razonsocial Ciudad Departamento Email Nit Direccion _id');
      if (!e) throw new ApiError(404, 'OT no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo oT:', err);
      throw new ApiError(500, 'Error obteniendo OT', 'GET_ERROR');
    }
  }

  async update(id, data, tenantId) {
    const session = await OT.startSession();
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);

      let updatedOt = null;
      await session.withTransaction(async () => {
        // Wrap completion side effects in one transaction to avoid partial sync states.
        const currentOt = await OT.findOne(applyTenantFilter({ _id: id }, t)).session(session);
        if (!currentOt) throw new ApiError(404, 'OT no encontrado', 'NOT_FOUND', { id });

        updatedOt = await OT.findOneAndUpdate(
          applyTenantFilter({ _id: id }, t),
          { $set: data },
          { new: true, runValidators: true, session }
        );

        const isCompleting = currentOt.EstadoOt !== 'Completado' && data.EstadoOt === 'Completado';
        if (!isCompleting) return;

        const repuestos = await Repuestos.find(
          applyTenantFilter({ OrdenId: currentOt._id, EstadoSolicitud: 'En Proceso' }, t)
        ).session(session);

        for (const repuesto of repuestos) {
          const qty = Number(repuesto.CantidadInstalacion || 0);
          if (repuesto.InventarioItemId && qty > 0) {
            // Atomic decrement with stock guard; fails transaction if stock is insufficient.
            const inv = await InventarioRepuesto.findOneAndUpdate(
              applyTenantFilter({ _id: repuesto.InventarioItemId, stockActual: { $gte: qty } }, t),
              { $inc: { stockActual: -qty } },
              { new: true, session }
            );
            if (!inv) {
              throw new ApiError(400, 'Insufficient stock', 'INSUFFICIENT_STOCK', {
                inventarioItemId: repuesto.InventarioItemId,
                required: qty,
              });
            }
          }

          const previousStatus = repuesto.EstadoSolicitud || 'En Proceso';
          repuesto.EstadoAnterior = previousStatus;
          repuesto.EstadoSolicitud = 'Instalado';
          repuesto.FechaInstalacion = repuesto.FechaInstalacion || new Date();
          await repuesto.save({ session });

          await RepuestoTrazabilidad.create([{
            tenantId: t,
            SolicitudRepuestoId: repuesto._id,
            Status: 'Instalado',
            EstadoActual: 'Instalado',
            EstadoA: 'Instalado',
            EstadoAnterior: previousStatus,
            EstadoNuevo: 'Instalado',
            FechaHoraCambio: new Date(),
            Comentarios: `Automatic: OT ${String(currentOt._id)} completed`,
          }], { session });
        }
      });

      logger.info('OT actualizado: ' + id);
      return updatedOt;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando ot:', err);
      throw new ApiError(500, 'Error actualizando OT', 'UPDATE_ERROR');
    } finally {
      await session.endSession();
    }
  }

  async delete(id, tenantId) {
    try {
      requireTenant(tenantId);
      const e = await OT.findOneAndUpdate(applyTenantFilter({ _id: id }, tenantId), { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'OT no encontrado', 'NOT_FOUND', { id });
      logger.info('OT eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando ot:', err);
      throw new ApiError(500, 'Error eliminando OT', 'DELETE_ERROR');
    }
  }

  async addEquipos(otId, body, tenantId) {
    try {
      const t = tenantId || body.tenantId;
      requireTenant(t);

      const ot = await OT.findOne(applyTenantFilter({ _id: otId }, t));
      if (!ot) throw new ApiError(404, 'OT no encontrado', 'NOT_FOUND', { id: otId });

      const createdEquipos = [];
      const createdReports = [];

      for (const item of Array.isArray(body.equipos) ? body.equipos : []) {
        let equipoId = null;
        let equipoDoc = null;

        if (item.equipoId) {
          equipoDoc = await EquipoItem.findOne(applyTenantFilter({ _id: item.equipoId }, t))
            .populate('ItemId', 'Nombre ProtocoloId')
            .populate('SedeId', 'nombreSede')
            .lean();
          if (!equipoDoc) throw new ApiError(404, 'Equipo no encontrado', 'EQUIPO_NOT_FOUND', { id: item.equipoId });
          equipoId = equipoDoc._id;
        } else if (item.equipo) {
          const eqData = { ...item.equipo, tenantId: t };
          const created = await EquipoItem.create(eqData);
          equipoId = created._id;
          equipoDoc = await EquipoItem.findById(equipoId)
            .populate('ItemId', 'Nombre ProtocoloId')
            .populate('SedeId', 'nombreSede')
            .lean();
          createdEquipos.push(created);
        } else {
          continue;
        }

        if (body.createReport !== false) {
          const nextReportSeq = await getNextSequence(t, 'REPORT');
          const reportConsec = formatConsecutivo('R', nextReportSeq, 6);

          const equipoSnapshot = {
            ItemText: equipoDoc?.ItemId?.Nombre || equipoDoc?.item || '',
            Marca: equipoDoc?.Marca || '',
            Modelo: equipoDoc?.Modelo || '',
            Sede: equipoDoc?.SedeId?.nombreSede || '',
            Serie: equipoDoc?.Serie || '',
            Inventario: equipoDoc?.Inventario || '',
            Servicio: equipoDoc?.Servicio?.nombre || '',
            Ubicacion: equipoDoc?.Ubicacion || '',
            MesesMtto: Array.isArray(equipoDoc?.mesesMtto) ? equipoDoc.mesesMtto : (equipoDoc?.Meses ? [equipoDoc.Meses] : []),
            protocoloMtto: equipoDoc?.ProtocoloId || equipoDoc?.protocoloId || '',
          };

          const rp = {
            tenantId: t,
            Equipo: equipoId,
            ClienteId: ot.ClienteId || null,
            consecutivo: reportConsec,
            estado: 'Pendiente',
            FechaCreacion: new Date(),
            orden: ot._id,
            equipoSnapshot,
            tipoMtto: ot.TipoServicio || 'Preventivo',
            ...(body.reportPayload || {})
          };

          const r = await Report.create(rp);
          createdReports.push(r);
          ot.reportes = Array.isArray(ot.reportes) ? ot.reportes.concat([r._id]) : [r._id];
        }
      }

      await ot.save();

      // Recompute OT progress
      const baseQuery = applyTenantFilter({ orden: ot._id, isDeleted: false }, t);
      const total = await Report.countDocuments(baseQuery);
      const closed = await Report.countDocuments(applyTenantFilter({ orden: ot._id, isDeleted: false, estado: 'Cerrado' }, t));
      const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
      let nuevoEstado = 'Pendiente';
      if (closed === total && total > 0) nuevoEstado = 'Cerrado';
      else if (closed > 0) nuevoEstado = 'En Progreso';

      ot.Avance = avance;
      ot.EstadoOt = nuevoEstado;
      await ot.save();

      logger.info(`Equipos añadidos a OT ${otId}`);
      return { equipos: createdEquipos, reports: createdReports, ot };
    } catch (err) {
      logger.error('Error añadiendo equipos a OT:', err);
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Error añadiendo equipos a OT', 'ADD_EQUIPOS_ERROR');
    }
  }
}

export const oTService = new OTService();
