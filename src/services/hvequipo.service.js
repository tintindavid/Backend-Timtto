import { HVEquipo } from '../models/hvequipo.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { firebaseStorageService } from './external/firebase.service.js';

export class HVEquipoService {
  /**
   * Procesa el campo foto: si es base64 lo sube a Firebase, si es URL la mantiene
   * @param {object} data - Datos que pueden contener foto
   * @returns {Promise<void>} Modifica data.foto directamente
   */
  async processFoto(data) {
    if (!data.Foto) return;

    // Si ya es una URL de Firebase o http/https, mantenerla
    if (data.Foto.startsWith('http://') || data.Foto.startsWith('https://')) {
      logger.debug('Foto ya es una URL, manteniéndola:', data.Foto.substring(0, 50));
      return;
    }

    // Si no es URL, asumirlo como base64 y subirlo
    try {
      logger.info('Procesando foto base64 para subir a Firebase Storage...');
      const fotoUrl = await firebaseStorageService.uploadBase64Image(
        data.Foto,
        'hvequipo',
        `hv_${Date.now()}`
      );
      data.Foto = fotoUrl;
      logger.info('Foto subida exitosamente:', fotoUrl);
    } catch (err) {
      logger.error('Error procesando foto:', err);
      // Si falla el upload, eliminar el campo foto para no guardar base64 en DB
      delete data.Foto;
      throw new ApiError(400, 'Error procesando imagen. Verifica que sea una imagen válida en base64.', 'FOTO_PROCESSING_ERROR');
    }
  }

  async create(data, tenantId) {
    try {
      requireTenant(tenantId);
      
      // Procesar foto si existe (base64 -> Firebase URL)
      await this.processFoto(data);
      
      const hvData = { ...data, tenantId };
      const entity = await HVEquipo.create(hvData);
      const equipo = await EquipoItem.findById(entity.EquipoId).lean();
      //actulizar campo TieneHV en EquipoItem
      if (equipo) {
        await EquipoItem.findByIdAndUpdate(entity.EquipoId, { TieneHV: true });
      }

      // actualizar campor Riesgo, Invima en EquipoItem si vienen en el payload
      if (entity && (entity.RegistroINVIMA || entity.ClasificacinRiesgo)) {
        const updateFields = {};
        if (entity.RegistroINVIMA) updateFields.Invima = entity.RegistroINVIMA;
        if (entity.ClasificacinRiesgo) updateFields.Riesgo = entity.ClasificacinRiesgo;

        await EquipoItem.findByIdAndUpdate(entity.EquipoId, { 
          $set: updateFields 
        });
      }

      return entity;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error creando HVEquipo:', err);
      throw new ApiError(500, 'Error creando HVEquipo', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      
      const baseFilter = { ...filters, isDeleted: false };
      const query = applyTenantFilter(baseFilter, tenantId);
      
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [
          { 'equipoSnapshot.ItemText': rx },
          { 'equipoSnapshot.Marca': rx },
          { 'equipoSnapshot.Modelo': rx },
          { Fabricante: rx },
          { TipoEquipo: rx },
          { RegistroINVIMA: rx }
        ];
      }
      
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      
      const [data, total] = await Promise.all([
        HVEquipo.find(query)
          .populate('EquipoId', 'ItemText Marca Modelo Serie')
          .populate('clienteId', 'Razonsocial Nit')
          .populate('userIdCreacion', 'firstName lastName email')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        HVEquipo.countDocuments(query),
      ]);
      
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), 
          hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando HVEquipos:', err);
      throw new ApiError(500, 'Error listando HVEquipos', 'LIST_ERROR');
    }
  }

  /**
   * Lista HVEquipos aprobadas por Marca y Modelo
   * @param {string} marca - Marca del equipo
   * @param {string} modelo - Modelo del equipo
   * @param {object} pagination - Opciones de paginación
   * @param {string} tenantId - ID del tenant
   */
  async listApprovedByMarcaModelo(marca, modelo, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = pagination;
      const skip = (page - 1) * limit;
      
      // Escapar caracteres especiales de regex y hacer búsqueda case-insensitive
      const escapedMarca = marca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedModelo = modelo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      const baseFilter = {
        EstadoHV: 'Aprobada',
        'equipoSnapshot.Marca': new RegExp(`^${escapedMarca}$`, 'i'),
        'equipoSnapshot.Modelo': new RegExp(`^${escapedModelo}$`, 'i'),
        isDeleted: false
      };
      
      const query = applyTenantFilter(baseFilter, tenantId);
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      
      const [data, total] = await Promise.all([
        HVEquipo.find(query)
          .populate('EquipoId', 'ItemText Marca Modelo Serie')
          .populate('clienteId', 'Razonsocial Nit')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        HVEquipo.countDocuments(query),
      ]);
      
      logger.info(`HVEquipos aprobadas encontradas: ${total} (Marca: ${marca}, Modelo: ${modelo})`);
      
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando HVEquipos aprobadas:', err);
      throw new ApiError(500, 'Error listando HVEquipos aprobadas', 'LIST_APPROVED_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const query = applyTenantFilter({ _id: id, isDeleted: false }, tenantId);
      const e = await HVEquipo.findOne(query)
        .populate('EquipoId', 'ItemText Marca Modelo Serie')
        .populate('clienteId', 'Razonsocial Nit Ciudad')
        .populate('userIdCreacion', 'firstName lastName email');
      
      if (!e) throw new ApiError(404, 'HVEquipo no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo HVEquipo:', err);
      throw new ApiError(500, 'Error obteniendo HVEquipo', 'GET_ERROR');
    }
  }

  /**
   * Obtiene HVEquipo por EquipoId (más reciente)
   * @param {string} equipoId - ID del equipo
   * @param {string} tenantId - ID del tenant
   */
  async getByEquipoId(equipoId, tenantId) {
    try {
      const query = applyTenantFilter({ EquipoId: equipoId, isDeleted: false }, tenantId);
      const hv = await HVEquipo.findOne(query)
        .populate('EquipoId', 'ItemText Marca Modelo Serie')
        .populate('clienteId', 'Razonsocial Nit Ciudad')
        .populate('userIdCreacion', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .lean();
      
      if (!hv) throw new ApiError(404, 'HVEquipo no encontrado para este equipo', 'NOT_FOUND', { equipoId });
      logger.info(`HVEquipo encontrada para EquipoId ${equipoId}: ${hv._id}`);
      return hv;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo HVEquipo por EquipoId:', err);
      throw new ApiError(500, 'Error obteniendo HVEquipo por EquipoId', 'GET_BY_EQUIPO_ERROR');
    }
  }

  async update(id, data, tenantId) {
    try {
      // Procesar foto si existe (base64 -> Firebase URL)
      await this.processFoto(data);
      
      const query = applyTenantFilter({ _id: id }, tenantId);
      const e = await HVEquipo.findOneAndUpdate(
        query,
        { $set: data },
        { new: true, runValidators: true }
      );

      // si estado es Aprobada, actualizar campo HVAprobada en EquipoItem
      if (e && data.EstadoHV === 'Aprobada') {
        await EquipoItem.findByIdAndUpdate(e.EquipoId, { 
          HVAprovada: true 
        });
      }

      
      // actualizar campor Riesgo, Invima en EquipoItem si vienen en el payload
      if (e && (e.RegistroINVIMA || e.ClasificacinRiesgo)) {
        const updateFields = {};
        if (e.RegistroINVIMA) updateFields.Invima = e.RegistroINVIMA;
        if (e.ClasificacinRiesgo) updateFields.Riesgo = e.ClasificacinRiesgo;

        await EquipoItem.findByIdAndUpdate(e.EquipoId, { 
          $set: updateFields 
        });
      }
      
      if (!e) throw new ApiError(404, 'HVEquipo no encontrado', 'NOT_FOUND', { id });
      logger.info(`HVEquipo actualizado: ${id}`);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando HVEquipo:', err);
      throw new ApiError(500, 'Error actualizando HVEquipo', 'UPDATE_ERROR');
    }
  }

  async delete(id, tenantId) {
    try {
      const query = applyTenantFilter({ _id: id }, tenantId);
      const e = await HVEquipo.findOneAndUpdate(
        query,
        { $set: { isDeleted: true, deletedAt: new Date() } },
        { new: true }
      );
      
      if (!e) throw new ApiError(404, 'HVEquipo no encontrado', 'NOT_FOUND', { id });
      logger.info(`HVEquipo eliminado (soft): ${id}`);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando HVEquipo:', err);
      throw new ApiError(500, 'Error eliminando HVEquipo', 'DELETE_ERROR');
    }
  }
}

export const hVEquipoService = new HVEquipoService();
