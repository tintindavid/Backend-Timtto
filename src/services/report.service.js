import { Report } from '../models/report.model.js';
import { ProtocoloMtto } from '../models/protocolomtto.model.js';
import { OT } from '../models/ot.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

/**
 * Mapa de mes abreviado a número (1-12)
 */
const MESES_MAP = {
  'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
  'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12
};

/**
 * Array inverso: número a mes abreviado
 */
const MESES_ARRAY = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Calcula el próximo mes de mantenimiento basado en el mes actual y los meses programados
 * @param {string} mesActual - Mes actual en formato abreviado (ene, feb, etc)
 * @param {string[]} mesesProgramados - Array de meses programados
 * @returns {string} Próximo mes programado
 */
function calcularProximoMtto(mesActual, mesesProgramados) {
  const mesActualNum = MESES_MAP[mesActual.toLowerCase()];
  
  // Convertir meses programados a números y ordenarlos
  const mesesProgramadosNum = mesesProgramados
    .map(m => MESES_MAP[m.toLowerCase()])
    .filter(Boolean) // Eliminar valores undefined
    .sort((a, b) => a - b);

  if (mesesProgramadosNum.length === 0) {
    return mesesProgramados[0]; // Fallback
  }

  // Buscar el siguiente mes programado después del mes actual
  const siguienteMes = mesesProgramadosNum.find(m => m > mesActualNum);

  if (siguienteMes) {
    // Hay un mes programado más adelante en el año
    return MESES_ARRAY[siguienteMes];
  } else {
    // No hay ninguno más adelante, usar el primero del ciclo (circularmente)
    return MESES_ARRAY[mesesProgramadosNum[0]];
  }
}

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

      // Update EquipoItem con estadoOperativo, mesesMttoRealizados, ProximoMtto, UltimoMtto
      if (updated.Equipo) {
        const equipoUpdate = {};
        
        // 1. Actualizar EstadoOperativo
        if (typeof data.estadoOperativo !== 'undefined') {
          equipoUpdate.EstadoOperativo = data.estadoOperativo;
        }

        // 2. Obtener el equipo actual para actualizar mesesMttoRealizados
        const equipoActual = await EquipoItem.findOne(applyTenantFilter({ _id: updated.Equipo }, t)).lean();
        
        logger.info(`Equipo actual encontrado: ${equipoActual ? 'SI' : 'NO'}`);
        logger.info(`Consecutivo del report: ${updated.consecutivo}`);
        
        if (equipoActual) {
          // Obtener fecha del mantenimiento (usar fechaProcesado o fecha actual)
          const fechaMtto = data.fechaProcesado ? new Date(data.fechaProcesado) : new Date();
          
          // Determinar el mes del mantenimiento (usando el array MESES_ARRAY)
          const mesActual = MESES_ARRAY[fechaMtto.getMonth() + 1]; // getMonth() retorna 0-11, necesitamos 1-12

          // Solo actualizar mesesMttoRealizados si existe consecutivo
          if (updated.consecutivo) {
            // Preparar nuevo registro de mantenimiento realizado
            const nuevoMttoRealizado = {
              fecha: fechaMtto,
              mes: mesActual,
              consecutivo: updated.consecutivo
            };

            logger.info(`Preparando registro de mtto: ${JSON.stringify(nuevoMttoRealizado)}`);

            // Verificar si ya existe este consecutivo en mesesMttoRealizados
            let mesesRealizados = Array.isArray(equipoActual.mesesMttoRealizados) ? [...equipoActual.mesesMttoRealizados] : [];
            const indexExistente = mesesRealizados.findIndex(m => m.consecutivo === updated.consecutivo);

            if (indexExistente !== -1) {
              // Si existe, actualizar el registro
              mesesRealizados[indexExistente] = nuevoMttoRealizado;
              logger.info(`Actualizando registro existente en índice ${indexExistente}`);
            } else {
              // Si no existe, agregarlo al array
              mesesRealizados.push(nuevoMttoRealizado);
              logger.info(`Agregando nuevo registro al array (total: ${mesesRealizados.length})`);
            }

            equipoUpdate.mesesMttoRealizados = mesesRealizados;
            equipoUpdate.UltimoMtto = fechaMtto;
            equipoUpdate.UltimoConsecutivoMtto = updated.consecutivo;
          } else {
            logger.warn('No se puede actualizar mesesMttoRealizados: consecutivo no disponible');
          }

          // 3. Calcular ProximoMtto basado en mesesMtto del equipo
          if (Array.isArray(equipoActual.mesesMtto) && equipoActual.mesesMtto.length > 0) {
            const mesesProgramados = equipoActual.mesesMtto.map(m => m.toLowerCase());
            equipoUpdate.ProximoMtto = calcularProximoMtto(mesActual, mesesProgramados);
            logger.info(`Próximo mantenimiento calculado: ${equipoUpdate.ProximoMtto} (después de ${mesActual})`);
          }
        }

        // Aplicar todas las actualizaciones al equipo
        if (Object.keys(equipoUpdate).length > 0) {
          logger.info(`Aplicando actualizaciones al equipo: ${JSON.stringify(equipoUpdate)}`);
          const equipoActualizado = await EquipoItem.findOneAndUpdate(
            applyTenantFilter({ _id: updated.Equipo }, t),
            { $set: equipoUpdate },
            { new: true, runValidators: true }
          );
          logger.info(`EquipoItem ${updated.Equipo} actualizado exitosamente`);
          logger.info(`mesesMttoRealizados después del update: ${JSON.stringify(equipoActualizado?.mesesMttoRealizados)}`);
        } else {
          logger.warn('No hay actualizaciones para aplicar al equipo');
        }
      }

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
