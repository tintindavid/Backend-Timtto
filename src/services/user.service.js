'use strict';
import { User } from '../models/user.model.js';
import { Role } from '../models/role.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { hashPassword, comparePassword } from '../utils/password.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class UserService {
  async create(data) {
    try {
      const tenantId = data.tenantId;
      requireTenant(tenantId);

      if (data.roleId) {
        const role = await Role.findOne({ _id: data.roleId, tenantId, isDeleted: false });
        if (!role) throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId: data.roleId });
      }

      const exists = await User.findOne({ tenantId, email: data.email });
      if (exists) throw new ApiError(409, 'El email ya está registrado para este tenant', 'EMAIL_ALREADY_EXISTS', { email: data.email });

      const user = await User.create(data);
      logger.info(`User creado: ${user._id}`);
      return user.toJSON();
    } catch (error) {
      logger.error('Error creando user:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error creando usuario', 'CREATE_ERROR');
    }
  }

  async findByEmail(email, tenantId) {
    return User.findOne({ email, tenantId }).lean();
  }

  async login(email, password, tenantId) {
    try {
      requireTenant(tenantId);

      logger.info(`Buscando usuario con email: ${email} y tenantId: ${tenantId}`);
      const user = await User.findOne({ email, tenantId });

     logger.info('Usuario autenticado1', {
        userId: user._id.toString(),
        tenantId,
        password: user.password
      });

      if (!user) throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');

      const match = await comparePassword(password, user.password);
      logger.info('Password compare result', { match });
      if (!match) throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');

      return user;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error en login:', error);
      throw new ApiError(500, 'Error en autenticación', 'AUTH_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search, role } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);

      if (search) {
        const regex = new RegExp(search, 'i');
        query.$or = [{ firstName: regex }, { lastName: regex }, { email: regex }, { username: regex }];
      }
      if (role) query.role = role;

      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

      const [data, total] = await Promise.all([
        User.find(query).sort(sort).skip(skip).limit(limit).lean(),
        User.countDocuments(query),
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
      logger.error('Error listando users:', error);
      throw new ApiError(500, 'Error listando usuarios', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const user = await User.findOne({ _id: id, tenantId });
      if (!user) throw new ApiError(404, 'Usuario no encontrado', 'NOT_FOUND', { userId: id });
      return user;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error obteniendo user:', error);
      throw new ApiError(500, 'Error obteniendo usuario', 'GET_ERROR');
    }
  }

  async update(id, data) {
    try {
      if (data.password) {
        data.password = await hashPassword(data.password);
      }

      const tenantId = data.tenantId || data._tenantId;
      requireTenant(tenantId);

      if (data.roleId) {
        const role = await Role.findOne({ _id: data.roleId, tenantId, isDeleted: false });
        if (!role) throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId: data.roleId });
      }

      const user = await User.findOneAndUpdate({ _id: id, tenantId }, { $set: data }, { new: true, runValidators: true });
      if (!user) throw new ApiError(404, 'Usuario no encontrado', 'NOT_FOUND', { userId: id });
      logger.info(`User actualizado: ${id}`);
      return user;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error actualizando user:', error);
      throw new ApiError(500, 'Error actualizando usuario', 'UPDATE_ERROR');
    }
  }

  async delete(id, tenantId) {
    try {
      requireTenant(tenantId);
      const user = await User.findOneAndUpdate({ _id: id, tenantId }, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!user) throw new ApiError(404, 'Usuario no encontrado', 'NOT_FOUND', { userId: id });
      logger.info(`User eliminado (soft): ${id}`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error eliminando user:', error);
      throw new ApiError(500, 'Error eliminando usuario', 'DELETE_ERROR');
    }
  }

  async assignRole(userId, roleId, tenantId) {
    try {
      requireTenant(tenantId);

      const role = await Role.findOne({ _id: roleId, tenantId, isDeleted: false });
      if (!role) throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId });

      const user = await User.findOneAndUpdate(
        { _id: userId, tenantId },
        { $set: { roleId } },
        { new: true, runValidators: true }
      );

      if (!user) throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND', { userId });

      return user.toJSON();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error asignando rol al user:', error);
      throw new ApiError(500, 'Error asignando rol al usuario', 'ASSIGN_ROLE_ERROR');
    }
  }
}

export const userService = new UserService();
