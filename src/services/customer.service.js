import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Servicios } from '../models/servicios.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { firebaseStorageService } from './external/firebase.service.js';

export class CustomerService {
  /**
   * Crea un nuevo customer con logo (si se proporciona)
   * @param {object} data - Datos del customer
   * @param {string} tenantId - ID del tenant
   * @param {object} logoFile - Archivo del logo (opcional) { buffer, originalname, mimetype }
   * @returns {Promise<object>} Customer creado
   */
  async create(data, tenantId, logoFile = null) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;

      // Si se proporciona un logo, subirlo a Firebase Storage
      if (logoFile && logoFile.buffer) {
        logger.info('Subiendo logo a Firebase Storage...');
        const logoUrl = await firebaseStorageService.uploadLogo(
          logoFile.buffer,
          logoFile.originalname,
          logoFile.mimetype
        );
        data.Logo = logoUrl;
      }
      const entity = await Customer.create(data);

      const payloadSedes = {
        tenantId: t,
        Cliente: entity._id,
        nombreSede: 'Principal',
        contact: entity.UserContacto || '',
        departamento: entity.Departamento || '',
        ciudad: entity.Ciudad || '',
        direccion: entity.Direccion || '',
        telefono: entity.TelContacto || '',
        email: entity.Email || '',
      };

      const sede = await Sedes.create(payloadSedes);

      const payloadServicio = {
        tenantId: t,
        Cliente: entity._id,
        sedeId: sede._id,
        nombre: 'Principal',
        observacion: 'Servicio creado por defecto al crear el cliente',
      };

      await Servicios.create(payloadServicio);

      logger.info('Customer creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando customer:', err);
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Error creando Customer', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ Razonsocial: rx }, { Ciudad: rx }, { Email: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Customer.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Customer.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando customers:', err);
      throw new ApiError(500, 'Error listando Customers', 'LIST_ERROR');
    }
  }

  async exportAll(filters = {}, tenantId) {
    try {
      const { search } = filters;
      const query = applyTenantFilter({ isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [
          { Razonsocial: rx },
          { Email: rx },
          { Ciudad: rx },
        ];
      }
      return await Customer.find(query).sort({ Razonsocial: 1 }).lean();
    } catch (err) {
      logger.error('Error exportando customers:', err);
      throw new ApiError(500, 'Error exportando Customers', 'EXPORT_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Customer.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo customer:', err);
      throw new ApiError(500, 'Error obteniendo Customer', 'GET_ERROR');
    }
  }

  /**
   * Actualiza un customer, incluyendo reemplazo de logo si se proporciona
   * @param {string} id - ID del customer
   * @param {object} data - Datos a actualizar
   * @param {string} tenantId - ID del tenant
   * @param {object} logoFile - Archivo del logo nuevo (opcional) { buffer, originalname, mimetype }
   * @returns {Promise<object>} Customer actualizado
   */
  async update(id, data, tenantId, logoFile = null) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);

      // Obtener customer actual para verificar si tiene logo previo
      const currentCustomer = await Customer.findOne(applyTenantFilter({ _id: id }, t));
      if (!currentCustomer) {
        throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      }

      // Si se proporciona un nuevo logo
      if (logoFile && logoFile.buffer) {
        logger.info('Reemplazando logo en Firebase Storage...');
        logger.debug('Datos del nuevo logo:', {
          originalname: logoFile.originalname,
          mimetype: logoFile.mimetype,
          size: logoFile.buffer.length,
        });
        const oldLogoUrl = currentCustomer.Logo;
        
        // Subir nuevo logo y eliminar el anterior
        const newLogoUrl = await firebaseStorageService.replaceLogo(
          oldLogoUrl,
          logoFile.buffer,
          logoFile.originalname,
          logoFile.mimetype
        );
        data.Logo = newLogoUrl;
      }

      const e = await Customer.findOneAndUpdate(
        applyTenantFilter({ _id: id }, t),
        { $set: data },
        { new: true, runValidators: true }
      );
      
      if (!e) throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      logger.info('Customer actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando customer:', err);
      throw new ApiError(500, 'Error actualizando Customer', 'UPDATE_ERROR');
    }
  }

  /**
   * Elimina un customer (soft delete) y su logo de Firebase Storage
   * @param {string} id - ID del customer
   * @param {string} tenantId - ID del tenant
   */
  async delete(id, tenantId) {
    try {
      requireTenant(tenantId);
      
      // Obtener customer antes de eliminarlo para limpiar el logo
      const customer = await Customer.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!customer) {
        throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      }

      // Soft delete del customer
      const e = await Customer.findOneAndUpdate(
        applyTenantFilter({ _id: id }, tenantId),
        { $set: { isDeleted: true, deletedAt: new Date() } },
        { new: true }
      );
      
      if (!e) throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });

      // Eliminar logo de Firebase Storage (en background)
      if (customer.Logo) {
        firebaseStorageService.deleteLogo(customer.Logo).catch(err => {
          logger.error('Error eliminando logo al borrar customer:', err);
        });
      }

      logger.info('Customer eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando customer:', err);
      throw new ApiError(500, 'Error eliminando Customer', 'DELETE_ERROR');
    }
  }
}

export const customerService = new CustomerService();
