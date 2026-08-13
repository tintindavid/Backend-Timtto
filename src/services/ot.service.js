import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { Customer } from '../models/customer.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../models/repuestotrazabilidad.model.js';
import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import { ticketService } from './ticket.service.js';
import { historyService } from './history.service.js';
import { runWithTransactionFallback } from '../utils/mongoSession.util.js';

export class OTService {
  async create(data, tenantId, user) {
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

      await historyService.record({
        tenantId: t,
        resourceType: 'OT',
        resourceId: entity._id,
        action: 'create',
        description: `OT ${entity.Consecutivo} creada${equipos.length ? ` con ${equipos.length} equipo(s)` : ''}`,
        userId: user?.userId || null,
        userName: user?.userName || user?.email || 'Sistema',
        metadata: { equiposCount: equipos.length, tipoServicio: entity.TipoServicio },
      });

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
      // Whitelist only the filters that make sense on OT (2026-08-02). Older
      // code spread `...filters` directly, which allowed arbitrary query
      // parameters to reach Mongo — including ones with no matching field.
      const { ClienteId, EstadoOt, Consecutivo, clienteName } = filters;
      const cleanFilters = {};
      if (ClienteId) cleanFilters.ClienteId = ClienteId;
      if (EstadoOt) cleanFilters.EstadoOt = EstadoOt;
      // Consecutivo is a partial match — the UI passes fragments like
      // "OT-0012" and expects "OT-001234" to hit. `\\` escapes regex meta
      // chars in the user input.
      if (Consecutivo) {
        const escaped = String(Consecutivo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanFilters.Consecutivo = new RegExp(escaped, 'i');
      }
      // Text search on the populated Customer.Razonsocial. Two-step:
      // resolve matching Customer IDs first, then filter OT.ClienteId $in
      // that set. Short-circuits with an empty page when no customer
      // matches — the outer query would otherwise return every OT if the
      // `$in` were left empty. Skips when ClienteId is already explicit.
      if (clienteName && !ClienteId) {
        const nameEscaped = String(clienteName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matchingCustomers = await Customer.find(
          applyTenantFilter({ Razonsocial: new RegExp(nameEscaped, 'i') }, tenantId),
        ).select('_id').lean();
        if (matchingCustomers.length === 0) {
          return {
            data: [],
            pagination: { page, limit, total: 0, pages: 0, hasNext: false, hasPrev: page > 1 },
          };
        }
        cleanFilters.ClienteId = { $in: matchingCustomers.map((c) => c._id) };
      }
      const query = applyTenantFilter({ ...cleanFilters, isDeleted: false }, tenantId);
      // Free-text `search` (kept for backwards compat) also targets Consecutivo
      // — previous $or matched fields that don't exist on the OT schema.
      if (search) {
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.Consecutivo = new RegExp(escaped, 'i');
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

  async update(id, data, tenantId, user) {
    const session = await OT.startSession();
    let cascadeCancelOt = false;
    let previousEstado = null;
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);

      let updatedOt = null;

      // Wrap completion side effects in one transaction to avoid partial
      // sync states. Falls back to a non-transactional path on standalone
      // MongoDB (dev) — see utils/mongoSession.util.js. Prod is Atlas
      // (replica set) so the txn path always wins there.
      const doUpdate = async (sess) => {
        const sessOpts = sess ? { session: sess } : {};
        const withSess = (q) => (sess ? q.session(sess) : q);

        const currentOt = await withSess(OT.findOne(applyTenantFilter({ _id: id }, t)));
        if (!currentOt) throw new ApiError(404, 'OT no encontrado', 'NOT_FOUND', { id });
        previousEstado = currentOt.EstadoOt;

        // isFromTicket guards (design D19): TipoServicio change is rejected.
        if (currentOt.isFromTicket) {
          if (typeof data.TipoServicio !== 'undefined' && data.TipoServicio !== currentOt.TipoServicio) {
            throw new ApiError(409, 'No se puede cambiar TipoServicio en una OT originada por tickets', 'OT_LOCKED_FROM_TICKET');
          }
          if (typeof data.reportes !== 'undefined') {
            throw new ApiError(409, 'No se pueden modificar los reportes de una OT originada por tickets', 'OT_LOCKED_FROM_TICKET');
          }
        }

        // Detect transition to Cancelado for the ticket cascade hook (D14).
        cascadeCancelOt =
          currentOt.isFromTicket &&
          currentOt.EstadoOt !== 'Cancelado' &&
          data.EstadoOt === 'Cancelado';

        updatedOt = await OT.findOneAndUpdate(
          applyTenantFilter({ _id: id }, t),
          { $set: data },
          { new: true, runValidators: true, ...sessOpts }
        );

        const isCompleting = currentOt.EstadoOt !== 'Completado' && data.EstadoOt === 'Completado';
        if (!isCompleting) return;

        const repuestos = await withSess(
          Repuestos.find(applyTenantFilter({ OrdenId: currentOt._id, EstadoSolicitud: 'En Proceso' }, t))
        );

        for (const repuesto of repuestos) {
          const qty = Number(repuesto.CantidadInstalacion || 0);
          if (repuesto.InventarioItemId && qty > 0) {
            // Atomic decrement with stock guard; fails the (txn or plain) op if stock is insufficient.
            const inv = await InventarioRepuesto.findOneAndUpdate(
              applyTenantFilter({ _id: repuesto.InventarioItemId, stockActual: { $gte: qty } }, t),
              { $inc: { stockActual: -qty } },
              { new: true, ...sessOpts }
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
          await repuesto.save(sessOpts);

          await RepuestoTrazabilidad.create(
            [{
              tenantId: t,
              SolicitudRepuestoId: repuesto._id,
              Status: 'Instalado',
              EstadoActual: 'Instalado',
              EstadoA: 'Instalado',
              EstadoAnterior: previousStatus,
              EstadoNuevo: 'Instalado',
              FechaHoraCambio: new Date(),
              Comentarios: `Automatic: OT ${String(currentOt._id)} completed`,
            }],
            sess ? { session: sess } : undefined
          );
        }
      };

      await runWithTransactionFallback(session, doUpdate);

      logger.info('OT actualizado: ' + id);

      // Ticket cascade (design D14): when an OT originated from tickets is
      // cancelled, revert the linked tickets to pendiente and cancel the
      // associated reports.
      if (cascadeCancelOt && updatedOt) {
        try {
          await ticketService.revertFromOTCancel(updatedOt._id, tenantId || data.tenantId);
          // Also cancel the associated reports so their lifecycle is consistent.
          await Report.updateMany(
            applyTenantFilter({ orden: updatedOt._id, isDeleted: false }, tenantId || data.tenantId),
            { $set: { estado: 'Cancelado', fechaCancelacion: new Date() } }
          );
        } catch (cascadeErr) {
          logger.error('Ticket cascade (OT cancel) failed', { err: String(cascadeErr) });
        }
      }

      // Record history AFTER the transaction so we don't pollute the timeline
      // with entries for a rollback.
      if (updatedOt) {
        const estadoChanged = data.EstadoOt && data.EstadoOt !== previousEstado;
        const description = estadoChanged
          ? `Estado cambiado de "${previousEstado}" a "${data.EstadoOt}"`
          : `OT actualizada`;
        await historyService.record({
          tenantId: tenantId || data.tenantId,
          resourceType: 'OT',
          resourceId: updatedOt._id,
          action: estadoChanged ? 'change-status' : 'update',
          description,
          userId: user?.userId || null,
          userName: user?.userName || user?.email || 'Sistema',
          changes: estadoChanged
            ? { EstadoOt: { from: previousEstado, to: data.EstadoOt } }
            : Object.keys(data).reduce((acc, key) => {
                acc[key] = { to: data[key] };
                return acc;
              }, {}),
        });
      }

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

  async addEquipos(otId, body, tenantId, user) {
    try {
      const t = tenantId || body.tenantId;
      requireTenant(t);

      const ot = await OT.findOne(applyTenantFilter({ _id: otId }, t));
      if (!ot) throw new ApiError(404, 'OT no encontrado', 'NOT_FOUND', { id: otId });

      // isFromTicket guard (design D19): cannot append equipos/reports to a
      // ticket-sourced OT — the report set is fixed at ticket-to-OT promotion.
      if (ot.isFromTicket) {
        throw new ApiError(409, 'No se pueden adicionar equipos a una OT originada por tickets', 'OT_LOCKED_FROM_TICKET');
      }

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

      await historyService.record({
        tenantId: t,
        resourceType: 'OT',
        resourceId: ot._id,
        action: 'add-equipos',
        description: `${createdReports.length || createdEquipos.length} equipo(s) añadido(s) a la OT`,
        userId: user?.userId || null,
        userName: user?.userName || user?.email || 'Sistema',
        metadata: {
          equiposCount: createdEquipos.length,
          reportsCount: createdReports.length,
        },
      });

      return { equipos: createdEquipos, reports: createdReports, ot };
    } catch (err) {
      logger.error('Error añadiendo equipos a OT:', err);
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Error añadiendo equipos a OT', 'ADD_EQUIPOS_ERROR');
    }
  }

  /**
   * Notas de OT — ad-hoc observations, ordered oldest → newest as stored.
   * Read/write scoped by tenant so a caller can never touch another tenant's OT.
   */
  async listNotas(otId, tenantId) {
    try {
      requireTenant(tenantId);
      const ot = await OT.findOne(applyTenantFilter({ _id: otId }, tenantId)).select('notas').lean();
      if (!ot) throw new ApiError(404, 'OT no encontrada', 'OT_NOT_FOUND', { otId });
      return ot.notas || [];
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error listando notas OT:', err);
      throw new ApiError(500, 'Error listando notas', 'LIST_NOTAS_ERROR');
    }
  }

  async addNota(otId, body, user, tenantId) {
    try {
      requireTenant(tenantId);
      const descripcion = (body?.descripcion || '').trim();
      if (!descripcion) {
        throw new ApiError(422, 'La descripción de la nota es obligatoria', 'INVALID_NOTA');
      }
      if (!user?.userId) {
        throw new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED');
      }

      const nota = {
        descripcion,
        fecha: new Date(),
        usuarioId: user.userId,
        usuarioNombre: body?.usuarioNombre?.trim() || 'Usuario',
      };

      const updated = await OT.findOneAndUpdate(
        applyTenantFilter({ _id: otId }, tenantId),
        { $push: { notas: nota } },
        { new: true, runValidators: true },
      ).select('notas').lean();

      if (!updated) throw new ApiError(404, 'OT no encontrada', 'OT_NOT_FOUND', { otId });

      logger.info(`Nota agregada a OT ${otId} por usuario ${user.userId}`);

      await historyService.record({
        tenantId,
        resourceType: 'OT',
        resourceId: otId,
        action: 'add-nota',
        description: `Nota agregada: "${nota.descripcion.slice(0, 80)}${nota.descripcion.length > 80 ? '…' : ''}"`,
        userId: user.userId,
        userName: nota.usuarioNombre,
      });

      return updated.notas || [];
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error agregando nota OT:', err);
      throw new ApiError(500, 'Error agregando nota', 'ADD_NOTA_ERROR');
    }
  }

  async deleteNota(otId, notaId, tenantId) {
    try {
      requireTenant(tenantId);
      const updated = await OT.findOneAndUpdate(
        applyTenantFilter({ _id: otId }, tenantId),
        { $pull: { notas: { _id: notaId } } },
        { new: true },
      ).select('notas').lean();
      if (!updated) throw new ApiError(404, 'OT no encontrada', 'OT_NOT_FOUND', { otId });
      logger.info(`Nota ${notaId} eliminada de OT ${otId}`);

      await historyService.record({
        tenantId,
        resourceType: 'OT',
        resourceId: otId,
        action: 'delete-nota',
        description: 'Nota eliminada',
      });

      return updated.notas || [];
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando nota OT:', err);
      throw new ApiError(500, 'Error eliminando nota', 'DELETE_NOTA_ERROR');
    }
  }
}

export const oTService = new OTService();
