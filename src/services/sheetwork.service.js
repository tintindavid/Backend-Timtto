import { SheetWork } from '../models/sheetwork.model.js';
import { Report } from '../models/report.model.js';
import { OT } from '../models/ot.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import { triggerTicketCascadeOnClose } from '../utils/ticketCascade.util.js';
export class SheetWorkService {

  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;

      // Map frontend field names to model fields
      if (data.recibidoPor && !data.personaRecibe) data.personaRecibe = data.recibidoPor;
      if (data.cargoRecibido && !data.cargoRecibe) data.cargoRecibe = data.cargoRecibido;
      if (data.firmaRecepcion && !data.firmaFile) data.firmaFile = data.firmaRecepcion;
      if (data.fullNameResponsable && !data.fullNameResponsable) data.fullNameResponsable = data.fullNameResponsable;
      if (data.cargoResponsable && !data.cargoResponsable) data.cargoResponsable = data.cargoResponsable;
      if (data.firmaResponsableFile && !data.firmaResponsableFile) data.firmaResponsableFile = data.firmaResponsableFile;

      // Auto-generate numeroHoja if not provided
      if (!data.numeroHoja) {
        try {
          // If OT provided, build numeroHoja as <OT.Consecutivo>-<n>
          const otId = data.otId || data.ot || data.orden || data.ordenId || data.otId;
          if (otId) {
            try {
              const ot = await OT.findOne(applyTenantFilter({ _id: otId }, t)).select('Consecutivo').lean();
              if (ot && ot.Consecutivo) {
                const sheetCount = await SheetWork.countDocuments(applyTenantFilter({ otId: otId, isDeleted: false }, t));
                const nextNumber = sheetCount + 1;
                data.numeroHoja = `${ot.Consecutivo}-${nextNumber}`;
              } else {
                // fallback to global sequence
                const nextSeq = await getNextSequence(t, 'SHEET');
                data.numeroHoja = formatConsecutivo('H', nextSeq, 4);
              }
            } catch (innerErr) {
              logger.debug && logger.debug('Error generating numeroHoja from OT, fallback to sequence', { err: String(innerErr) });
              const nextSeq = await getNextSequence(t, 'SHEET');
              data.numeroHoja = formatConsecutivo('H', nextSeq, 4);
            }
          } else {
            const nextSeq = await getNextSequence(t, 'SHEET');
            data.numeroHoja = formatConsecutivo('H', nextSeq, 4);
          }
        } catch (seqErr) {
          logger.debug && logger.debug('Could not generate numeroHoja sequence', { err: String(seqErr) });
        }
      }

      // si firmaFile existe entonces el estado de la hoja de trabajo es "Firmada", de lo contrario "Borrador"
      if (data.firmaFile) {
        data.estado = 'Firmada';
      } else {
        data.estado = 'Borrador';
      }
   
      const entity = await SheetWork.create(data);

      // despues de crear la hoja de trabajo, marcar los reportes listados como cerrados y vincular hojaDeTrabajo
      const updatedReports = [];
      if (Array.isArray(data.reports) && data.reports.length) {
        const fechaFin = data.fechaCreacion ? new Date(data.fechaCreacion) : new Date();
        for (const rId of data.reports) {
          try {
            const updated = await Report.findOneAndUpdate(
              applyTenantFilter({ _id: rId }, t),
              { $set: { 
                estado: 'Cerrado', 
                fechaFinalizdo: fechaFin, 
                hojaDeTrabajo: entity._id 
              } },
              { new: true }
            );
            if (updated) updatedReports.push(updated);
          } catch (e) {
            logger.warn('No se pudo actualizar report ' + rId + ': ' + e.message);
          }
        }
      }

      // Attach updated report ids to sheetWork.reports if any
      if (updatedReports.length) {
        entity.reports = updatedReports.map((r) => r._id);
        await entity.save();
      } else if (Array.isArray(data.reports) && data.reports.length) {
        // if client provided reports array, attach those ids
        entity.reports = data.reports;
        await entity.save();
      }

      // Update OT progress/state if otId provided
      try {
        const otId = data.otId || data.ot || entity.otId;
        if (otId) {
          const total = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false }, t));
          const closed = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false, estado: 'Cerrado' }, t));
          const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
          let nuevoEstado = 'Pendiente';
          if (closed === total && total > 0) nuevoEstado = 'Cerrado';
          else if (closed > 0) nuevoEstado = 'En Progreso';
          await OT.findOneAndUpdate(applyTenantFilter({ _id: otId }, t), { $set: { Avance: avance, EstadoOt: nuevoEstado } });
        }
      } catch (e) {
        logger.warn('No se pudo actualizar OT tras crear hoja de trabajo: ' + e.message);
      }

      logger.info('SheetWork creado: ' + entity._id);
      return { sheetWork: entity, reports: updatedReports };
    } catch (err) {
      logger.error('Error creando sheetWork:', err);
      throw new ApiError(500, 'Error creando SheetWork', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);
      
      // Búsqueda en campos relevantes de SheetWork
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [
          { numeroHoja: rx },
          { personaRecibe: rx },
          { fullNameResponsable: rx },
          { cargoResponsable: rx },
          { observaciones: rx }
        ];
      }
      
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

      // hojas de trabajo populadas
      const [data, total] = await Promise.all([
        SheetWork.find(query).sort(sort).skip(skip).limit(limit).lean()
        .populate('reports')
        .populate('clienteId'),
        SheetWork.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando sheetWorks:', err);
      throw new ApiError(500, 'Error listando SheetWorks', 'LIST_ERROR');
    }
  }

  async listByOt(otId, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ otId: otId, isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ numeroHoja: rx }, { personaRecibe: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        SheetWork.find(query)
        .populate('reports')
        .populate('clienteId')
        .sort(sort).skip(skip).limit(limit).lean(),
        SheetWork.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando sheetWorks por OT:', err);
      throw new ApiError(500, 'Error listando SheetWorks por OT', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await SheetWork.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo sheetWork:', err);
      throw new ApiError(500, 'Error obteniendo SheetWork', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      const e = await SheetWork.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
      if (!e) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      logger.info('SheetWork actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando sheetWork:', err);
      throw new ApiError(500, 'Error actualizando SheetWork', 'UPDATE_ERROR');
    }
  }

  /**
   * Admin retro-mitigation (design D6, sheet-report-closure spec): closes
   * every `Procesado` report linked to this specific sheet
   * (`hojaDeTrabajo === sheetId`), recomputes the parent OT's
   * `Avance`/`EstadoOt`, and dispatches the ticket-closure cascade. Scoped
   * narrowly to the sheet's own reports — never touches reports of another
   * sheet or reports in a different estado (e.g. `Cancelado`).
   *
   * @param {string} sheetId
   * @param {string} tenantId
   * @returns {Promise<{ modifiedCount: number }>}
   */
  async closeReports(sheetId, tenantId) {
    try {
      requireTenant(tenantId);

      const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId, isDeleted: false }, tenantId)).lean();
      if (!sheet) {
        throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND', { id: sheetId });
      }

      const now = new Date();
      const result = await Report.updateMany(
        applyTenantFilter({ hojaDeTrabajo: sheetId, isDeleted: false, estado: 'Procesado' }, tenantId),
        [
          {
            $set: {
              estado: 'Cerrado',
              fechaFinalizdo: { $ifNull: ['$fechaFinalizdo', now] },
            },
          },
        ]
      );

      // Recompute Avance/EstadoOt for the sheet's OT — same pattern as
      // create() above / clientPortal.service.js#signAndCreateSheets.
      const otId = sheet.otId;
      if (otId) {
        try {
          const total = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false }, tenantId));
          const closed = await Report.countDocuments(
            applyTenantFilter({ orden: otId, isDeleted: false, estado: 'Cerrado' }, tenantId)
          );
          const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
          let nuevoEstado = 'Pendiente';
          if (closed === total && total > 0) nuevoEstado = 'Cerrado';
          else if (closed > 0) nuevoEstado = 'En Progreso';
          await OT.findOneAndUpdate(applyTenantFilter({ _id: otId }, tenantId), {
            $set: { Avance: avance, EstadoOt: nuevoEstado },
          });
        } catch (otErr) {
          logger.warn('closeReports: OT progress recompute failed (non-fatal)', { sheetId, err: String(otErr) });
        }
      }

      // Ticket cascade for the reports this call actually closed.
      try {
        const closedReports = await Report.find(
          applyTenantFilter({ hojaDeTrabajo: sheetId, isDeleted: false, estado: 'Cerrado' }, tenantId)
        )
          .select('_id')
          .lean();
        await triggerTicketCascadeOnClose(closedReports.map((r) => r._id), tenantId);
      } catch (cascadeErr) {
        logger.warn('closeReports: ticket cascade failed (non-fatal)', { sheetId, err: String(cascadeErr) });
      }

      logger.info('SheetWork closeReports: reports closed', {
        sheetId,
        tenantId,
        modifiedCount: result.modifiedCount,
      });
      return { modifiedCount: result.modifiedCount };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error closing reports for sheetWork:', err);
      throw new ApiError(500, 'Error cerrando reportes de la hoja de trabajo', 'CLOSE_REPORTS_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await SheetWork.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      logger.info('SheetWork eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando sheetWork:', err);
      throw new ApiError(500, 'Error eliminando SheetWork', 'DELETE_ERROR');
    }
  }
}

export const sheetWorkService = new SheetWorkService();
