import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { logger } from '../config/logger.config.js';

export class TenantService {
  /**
   * Crea un nuevo tenant con logo (si se proporciona)
   * @param {object} data - Datos del tenant
   * @param {object} logoFile - Archivo del logo (opcional) { buffer, originalname, mimetype }
   */
  static async create(data, logoFile = null) {
    const exists = await Tenant.findOne({ tenantId: data.tenantId }).lean();
    if (exists) throw new ApiError(409, 'Tenant already exists', 'TENANT_EXISTS');
    
    // Si se proporciona un logo, subirlo a Firebase Storage
    if (logoFile && logoFile.buffer) {
      logger.info('Subiendo logo de tenant a Firebase Storage...');
      const logoUrl = await firebaseStorageService.uploadLogo(
        logoFile.buffer,
        logoFile.originalname,
        logoFile.mimetype,
        'logos/tenants'
      );
      data.logoUrl = logoUrl;
    }
    
    const tenant = await Tenant.create(data);
    return tenant.toJSON();
  }

  static async getByTenantId(tenantId) {
    // Búsqueda case-insensitive usando regex
    const tenant = await Tenant.findOne({ 
      tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') }
    }).lean();
    if (!tenant) throw new ApiError(404, 'Tenant not found', 'TENANT_NOT_FOUND');
    return tenant;
  }

  static async list({ page = 1, limit = 10, search = null } = {}) {
    const skip = (page - 1) * limit;
    const query = {};
    
    // Si hay búsqueda, aplicar filtro case-insensitive
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { tenantId: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
      ];
    }
    
    const [data, total] = await Promise.all([
      Tenant.find(query).skip(skip).limit(limit).lean(),
      Tenant.countDocuments(query),
    ]);
    return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  /**
   * Actualiza un tenant, incluyendo reemplazo de logo si se proporciona
   * @param {string} tenantId - ID del tenant
   * @param {object} payload - Datos a actualizar
   * @param {object} logoFile - Archivo del logo nuevo (opcional) { buffer, originalname, mimetype }
   */
  static async update(tenantId, payload, logoFile = null) {
    // Obtener tenant actual para verificar si tiene logo previo
    const currentTenant = await Tenant.findOne({ 
      tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') } 
    });
    if (!currentTenant) throw new ApiError(404, 'Tenant not found', 'TENANT_NOT_FOUND');
    
    // Si se proporciona un nuevo logo
    if (logoFile && logoFile.buffer) {
      logger.info('Reemplazando logo de tenant en Firebase Storage...');
      const oldLogoUrl = currentTenant.logoUrl;
      
      // Subir nuevo logo y eliminar el anterior
      const newLogoUrl = await firebaseStorageService.replaceLogo(
        oldLogoUrl,
        logoFile.buffer,
        logoFile.originalname,
        logoFile.mimetype
      );
      payload.logoUrl = newLogoUrl;
    }
    
    const tenant = await Tenant.findOneAndUpdate(
      { tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') } },
      { $set: payload },
      { new: true }
    ).lean();
    if (!tenant) throw new ApiError(404, 'Tenant not found', 'TENANT_NOT_FOUND');
    return tenant;
  }

  /**
   * Elimina un tenant (soft delete) y su logo de Firebase Storage
   * @param {string} tenantId - ID del tenant
   */
  static async softDelete(tenantId) {
    // Obtener tenant antes de eliminarlo para limpiar el logo
    const tenant = await Tenant.findOne({ 
      tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') } 
    });
    if (!tenant) throw new ApiError(404, 'Tenant not found', 'TENANT_NOT_FOUND');
    
    // Soft delete del tenant
    const deletedTenant = await Tenant.findOneAndUpdate(
      { tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') } },
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    ).lean();
    
    // Eliminar logo de Firebase Storage (en background)
    if (tenant.logoUrl) {
      firebaseStorageService.deleteLogo(tenant.logoUrl).catch(err => {
        logger.error('Error eliminando logo al borrar tenant:', err);
      });
    }
    
    return deletedTenant;
  }

  static async exists(tenantId) {
    if (!tenantId) return false;
    return Tenant.exists({ 
      tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') },
      isDeleted: false 
    });
  }

  /**
   * Lista TODOS los tenants (para superAdmin)
   * No aplica filtro de soft delete
   */
  static async listAll({ page = 1, limit = 10, search = null, includeDeleted = false } = {}) {
    const skip = (page - 1) * limit;
    const query = includeDeleted ? {} : { isDeleted: false };
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { tenantId: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
      ];
    }
    
    const [data, total] = await Promise.all([
      Tenant.find(query).skip(skip).limit(limit).lean(),
      Tenant.countDocuments(query),
    ]);
    return { 
      data, 
      pagination: { 
        page, 
        limit, 
        total, 
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      } 
    };
  }
}
