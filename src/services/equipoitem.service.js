import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { Report } from '../models/report.model.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { ticketService } from './ticket.service.js';
import { normalizeSerial, serialHasDigit } from '../utils/serial.util.js';

const DUPLICATE_CHECK_BULK_LIMIT = 500;

export class EquipoItemService {
  /**
   * Checks whether (tenantId, ClienteId, ItemId, normalize(Marca),
   * normalize(Serie)) already exists among non-deleted equipos.
   * No conflict is enforced when `ItemId` is missing or the normalized
   * serial is not digit-bearing (design.md D3/D8).
   *
   * @param {{ClienteId, ItemId, Marca, Serie, excludeId?}} fields
   * @param {string} tenantId
   * @returns {Promise<{conflict: boolean, existing?: object}>}
   */
  async checkDuplicate({ ClienteId, ItemId, Marca, Serie, excludeId } = {}, tenantId) {
    try {
      requireTenant(tenantId);

      const normalizedSerie = normalizeSerial(Serie || '');
      if (!ItemId || !serialHasDigit(normalizedSerie)) {
        return { conflict: false };
      }

      const query = applyTenantFilter({
        ClienteId,
        ItemId,
        Marca: normalizeSerial(Marca),
        SerieNormalized: normalizedSerie,
        isDeleted: false,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      }, tenantId);

      const existing = await EquipoItem.findOne(query)
        .collation({ locale: 'en', strength: 2 })
        .populate('ItemId', 'Nombre')
        .populate('SedeId', 'nombreSede')
        .populate('Servicio', 'nombre')
        .lean();

      if (!existing) return { conflict: false };
      return { conflict: true, existing };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error verificando duplicado de equipoItem:', err);
      throw new ApiError(500, 'Error verificando duplicado de EquipoItem', 'DUPLICATE_CHECK_ERROR');
    }
  }

  /**
   * Bulk variant of checkDuplicate — caps input at 500 rows.
   *
   * @param {Array<{rowId, ClienteId, ItemId, Marca, Serie}>} items
   * @param {string} tenantId
   * @returns {Promise<Record<string, {conflict: boolean, existing?: object}>>}
   */
  async checkDuplicateBulk(items, tenantId) {
    requireTenant(tenantId);
    if (!Array.isArray(items) || items.length > DUPLICATE_CHECK_BULK_LIMIT) {
      throw new ApiError(400, 'Máximo 500 items por request', 'BULK_LIMIT_EXCEEDED');
    }

    const entries = await Promise.all(
      items.map(async (item) => [item.rowId, await this.checkDuplicate(item, tenantId)])
    );

    return Object.fromEntries(entries);
  }

  /**
   * Runs checkDuplicate and, on conflict, logs the observability event and
   * throws the standard 409 EQUIPO_DUPLICATE ApiError.
   */
  async _guardDuplicate({ ClienteId, ItemId, Marca, Serie, excludeId }, tenantId, panelUser) {
    const result = await this.checkDuplicate({ ClienteId, ItemId, Marca, Serie, excludeId }, tenantId);
    if (result.conflict) {
      this._logDuplicateDetected({ tenantId, ClienteId, ItemId, Marca, Serie, existing: result.existing, panelUser });
      throw new ApiError(409, 'Equipo duplicado', 'EQUIPO_DUPLICATE', { existing: result.existing });
    }
    return result;
  }

  _logDuplicateDetected({ tenantId, ClienteId, ItemId, Marca, Serie, existing, panelUser }) {
    logger.warn('Duplicate equipo detected', {
      event: 'equipoItem.duplicate.detected',
      tenantId,
      ClienteId,
      ItemId,
      Marca,
      SerieNormalized: normalizeSerial(Serie || ''),
      existingId: existing?._id,
      attemptedBy: panelUser?.userId || null,
    });
  }

  async create(data, tenantId, panelUser = null) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;

      await this._guardDuplicate({ ClienteId: data.ClienteId, ItemId: data.ItemId, Marca: data.Marca, Serie: data.Serie }, t, panelUser);

      let entity;
      try {
        entity = await EquipoItem.create(data);
      } catch (insertErr) {
        if (insertErr && insertErr.code === 11000) {
          // Race: another concurrent create won between our guard check and
          // the insert. Re-fetch the winner and translate to the same 409
          // shape (design.md D1, spec scenario "E11000 raises 409").
          const race = await this.checkDuplicate({ ClienteId: data.ClienteId, ItemId: data.ItemId, Marca: data.Marca, Serie: data.Serie }, t);
          this._logDuplicateDetected({ tenantId: t, ClienteId: data.ClienteId, ItemId: data.ItemId, Marca: data.Marca, Serie: data.Serie, existing: race.existing, panelUser });
          throw new ApiError(409, 'Equipo duplicado', 'EQUIPO_DUPLICATE', { existing: race.existing });
        }
        throw insertErr;
      }

      logger.info('EquipoItem creado: ' + entity._id);
      return entity;
    } catch (err) {
      if (err instanceof ApiError) throw err;
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

  async update(id, data, tenantId, panelUser = null) {
    try {
      const touchesTuple = ['ItemId', 'Marca', 'Serie'].some((k) => typeof data[k] !== 'undefined');

      if (touchesTuple) {
        const current = await EquipoItem.findById(id).lean();
        if (!current) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
        const t = tenantId || current.tenantId;

        const changed = ['ItemId', 'Marca', 'Serie'].some((k) => {
          if (typeof data[k] === 'undefined') return false;
          return String(current[k]) !== String(data[k]);
        });

        if (changed) {
          await this._guardDuplicate({
            ClienteId: current.ClienteId,
            ItemId: typeof data.ItemId !== 'undefined' ? data.ItemId : current.ItemId,
            Marca: typeof data.Marca !== 'undefined' ? data.Marca : current.Marca,
            Serie: typeof data.Serie !== 'undefined' ? data.Serie : current.Serie,
            excludeId: id,
          }, t, panelUser);
        }
      }

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

  async delete(id, tenantId = null, panelUser = null) {
    try {
      // Resolve tenantId from the equipo if not supplied (backwards compat).
      const existing = await EquipoItem.findById(id).lean();
      if (!existing) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
      const t = tenantId || existing.tenantId;

      // Ticket cascade (design D20): cancel pendiente tickets referencing
      // this equipo BEFORE the soft-delete is persisted, so the operation
      // is observable as a single user-perceived event.
      try {
        await ticketService.cancelOnEquipmentDelete(existing._id, t, panelUser);
      } catch (cascadeErr) {
        logger.error('Ticket cascade (equipo soft-delete) failed', { err: String(cascadeErr) });
      }

      const e = await EquipoItem.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id });
      logger.info('EquipoItem eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando equipoItem:', err);
      throw new ApiError(500, 'Error eliminando EquipoItem', 'DELETE_ERROR');
    }
  }

  async updateAndSnapshot(equipoId, payload, tenantId, panelUser = null) {
    try {
      const t = tenantId || payload.tenantId;
      requireTenant(t);

      logger.info('Updating EquipoItem and snapshot for Report', {payload})
      // Update equipo fields (only fields provided in payload)
      const updateFields = {};
      ['Marca','Serie','Inventario','Ubicacion','Modelo','Riesgo','Invima','mesesMtto','Servicio','SedeId','ItemId'].forEach((k) => {
        if (typeof payload[k] !== 'undefined') updateFields[k] = payload[k];
      });

      const touchesTuple = ['ItemId', 'Marca', 'Serie'].some((k) => typeof updateFields[k] !== 'undefined');
      if (touchesTuple) {
        const current = await EquipoItem.findById(equipoId).lean();
        if (!current) throw new ApiError(404, 'EquipoItem no encontrado', 'NOT_FOUND', { id: equipoId });

        const changed = ['ItemId', 'Marca', 'Serie'].some((k) => {
          if (typeof updateFields[k] === 'undefined') return false;
          return String(current[k]) !== String(updateFields[k]);
        });

        if (changed) {
          await this._guardDuplicate({
            ClienteId: current.ClienteId,
            ItemId: typeof updateFields.ItemId !== 'undefined' ? updateFields.ItemId : current.ItemId,
            Marca: typeof updateFields.Marca !== 'undefined' ? updateFields.Marca : current.Marca,
            Serie: typeof updateFields.Serie !== 'undefined' ? updateFields.Serie : current.Serie,
            excludeId: equipoId,
          }, t, panelUser);
        }
      }

      logger.info('Updating EquipoItem with fields: ',updateFields);
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
        Riesgo: equipo?.Riesgo || '',
        Invima: equipo?.Invima || '',
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
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando equipo y snapshot:', err);
      throw new ApiError(500, 'Error actualizando Equipo y snapshot', 'UPDATE_SNAPSHOT_ERROR');
    }
  }

  /**
   * Obtiene equipos que tienen el mes especificado en mesesMtto, organizados por cliente > servicio > sede
   * @param {string} mes - Mes en formato abreviado (ene, feb, mar, etc.)
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} Equipos organizados jerárquicamente
   */
  async getByMesMantenimiento(mes, tenantId) {
    try {
      requireTenant(tenantId);
      
      // Buscar equipos que tengan el mes en su array mesesMtto
      const query = applyTenantFilter({
        mesesMtto: { $in: [mes.toLowerCase()] },
        isDeleted: false
      }, tenantId);

      const equipos = await EquipoItem.find(query)
        .populate('ClienteId', 'Razonsocial Nit contactEmail contactPhone')
        .populate('Servicio', 'nombre descripcion')
        .populate('SedeId', 'nombreSede direccion ciudad telefono')
        .populate('ItemId', 'Nombre Descripcion Categoria')
        .lean();

      logger.info(`Equipos encontrados con mes ${mes}: ${equipos.length}`);

      // Organizar por cliente > servicio > sede
      const organizacion = {};

      equipos.forEach(equipo => {
        const clienteId = equipo.ClienteId?._id?.toString() || 'sin_cliente';
        const servicioId = equipo.Servicio?._id?.toString() || 'sin_servicio';
        const sedeId = equipo.SedeId?._id?.toString() || 'sin_sede';

        // Inicializar cliente si no existe
        if (!organizacion[clienteId]) {
          organizacion[clienteId] = {
            cliente: equipo.ClienteId || { _id: 'sin_cliente', Razonsocial: 'Sin Cliente' },
            servicios: {}
          };
        }

        // Inicializar servicio si no existe
        if (!organizacion[clienteId].servicios[servicioId]) {
          organizacion[clienteId].servicios[servicioId] = {
            servicio: equipo.Servicio || { _id: 'sin_servicio', nombre: 'Sin Servicio' },
            sedes: {}
          };
        }

        // Inicializar sede si no existe
        if (!organizacion[clienteId].servicios[servicioId].sedes[sedeId]) {
          organizacion[clienteId].servicios[servicioId].sedes[sedeId] = {
            sede: equipo.SedeId || { _id: 'sin_sede', nombreSede: 'Sin Sede' },
            equipos: []
          };
        }

        // Agregar equipo a la sede correspondiente
        organizacion[clienteId].servicios[servicioId].sedes[sedeId].equipos.push(equipo);
      });

      // Convertir objetos a arrays para mejor presentación
      const resultado = Object.values(organizacion).map(cliente => ({
        cliente: cliente.cliente,
        servicios: Object.values(cliente.servicios).map(servicio => ({
          servicio: servicio.servicio,
          sedes: Object.values(servicio.sedes).map(sede => ({
            sede: sede.sede,
            equipos: sede.equipos,
            totalEquipos: sede.equipos.length
          })),
          totalEquipos: Object.values(servicio.sedes).reduce((acc, sede) => acc + sede.equipos.length, 0)
        })),
        totalEquipos: Object.values(cliente.servicios).reduce((acc, servicio) => 
          acc + Object.values(servicio.sedes).reduce((acc2, sede) => acc2 + sede.equipos.length, 0), 0)
      }));

      return {
        mes,
        totalEquipos: equipos.length,
        data: resultado
      };
    } catch (err) {
      logger.error('Error obteniendo equipos por mes:', err);
      throw new ApiError(500, 'Error obteniendo equipos por mes de mantenimiento', 'GET_BY_MES_ERROR');
    }
  }
}

export const equipoItemService = new EquipoItemService();
