'use strict';

import { Role } from '../models/role.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { PERMISSION_VALUES } from '../constants/permissions.js';
import { requireTenant } from '../utils/tenant.util.js';

function validatePermissions(permissions = []) {
  const invalid = permissions.filter((permission) => !PERMISSION_VALUES.includes(permission));
  if (invalid.length > 0) {
    throw new ApiError(422, 'Permisos inválidos', 'INVALID_PERMISSION', { invalid });
  }
}

export class RoleService {
  async create(tenantId, data) {
    try {
      requireTenant(tenantId);
      validatePermissions(data.permissions);

      const exists = await Role.findOne({ tenantId, name: data.name });
      if (exists) {
        throw new ApiError(409, 'El rol ya existe para este tenant', 'DUPLICATE_ROLE', { name: data.name });
      }

      const role = await Role.create({ ...data, tenantId });
      return role.toJSON();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error creando rol:', error);
      throw new ApiError(500, 'Error creando rol', 'CREATE_ROLE_ERROR');
    }
  }

  async list(tenantId, { page = 1, limit = 10 } = {}) {
    try {
      requireTenant(tenantId);
      const skip = (page - 1) * limit;

      const query = { tenantId, isDeleted: false };
      const [data, total] = await Promise.all([
        Role.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Role.countDocuments(query),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error listando roles:', error);
      throw new ApiError(500, 'Error listando roles', 'LIST_ROLE_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      requireTenant(tenantId);
      const role = await Role.findOne({ _id: id, tenantId });
      if (!role) {
        throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId: id });
      }
      return role.toJSON();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error obteniendo rol:', error);
      throw new ApiError(500, 'Error obteniendo rol', 'GET_ROLE_ERROR');
    }
  }

  async update(id, tenantId, data) {
    try {
      requireTenant(tenantId);
      if (data.permissions) validatePermissions(data.permissions);

      const current = await Role.findOne({ _id: id, tenantId, isDeleted: false }).lean();
      if (!current) {
        throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId: id });
      }
      // System roles (e.g. Admin) cannot be renamed or converted to a regular role.
      // Editing their permission list is still allowed so the tenant can extend
      // the catalog as new permissions ship.
      if (current.isSystem) {
        if (data.name && data.name !== current.name) {
          throw new ApiError(409, 'No se puede renombrar un rol del sistema', 'SYSTEM_ROLE_LOCKED', { roleId: id });
        }
        if (typeof data.isSystem === 'boolean' && data.isSystem !== true) {
          throw new ApiError(409, 'No se puede desmarcar isSystem en un rol del sistema', 'SYSTEM_ROLE_LOCKED', { roleId: id });
        }
      }

      const existing = await Role.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: data },
        { new: true, runValidators: true }
      );

      return existing.toJSON();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error actualizando rol:', error);
      throw new ApiError(500, 'Error actualizando rol', 'UPDATE_ROLE_ERROR');
    }
  }

  async softDelete(id, tenantId) {
    try {
      requireTenant(tenantId);
      const current = await Role.findOne({ _id: id, tenantId, isDeleted: false }).lean();
      if (!current) {
        throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId: id });
      }
      if (current.isSystem) {
        throw new ApiError(409, 'No se puede eliminar un rol del sistema', 'SYSTEM_ROLE_LOCKED', { roleId: id });
      }
      await Role.updateOne(
        { _id: id, tenantId },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );

      return null;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error eliminando rol:', error);
      throw new ApiError(500, 'Error eliminando rol', 'DELETE_ROLE_ERROR');
    }
  }
}

export const roleService = new RoleService();