'use strict';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { hashPassword, comparePassword } from '../utils/password.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

export class UserService {
  async create(data) {
    try {
      const tenantId = data.tenantId;
      requireTenant(tenantId);

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

  /**
   * Changes the authenticated user's own password.
   *
   * Verifies currentPassword against the stored bcrypt hash, then assigns
   * newPassword (the pre-save hook re-hashes it) and clears mustChangePassword.
   *
   * @param {string} userId        - MongoDB _id from JWT
   * @param {string} tenantId      - from JWT (used to scope the user lookup)
   * @param {string} currentPassword - plain-text current password to verify
   * @param {string} newPassword     - plain-text new password to set
   * @returns {object} Updated user document (toJSON, no password)
   */
  async changePassword(userId, tenantId, currentPassword, newPassword) {
    try {
      requireTenant(tenantId);

      // Fetch with password field (excluded from normal queries via toJSON).
      const user = await User.findOne({ _id: userId, tenantId });
      if (!user) throw new ApiError(404, 'Usuario no encontrado', 'NOT_FOUND', { userId });

      const match = await comparePassword(currentPassword, user.password);
      if (!match) {
        throw new ApiError(401, 'La contraseña actual no es correcta', 'INVALID_CURRENT_PASSWORD');
      }

      // Assign plain — pre-save hook hashes automatically.
      user.password = newPassword;
      user.mustChangePassword = false;

      await user.save();

      logger.info(`UserService: password changed for user ${userId}`);
      return user.toJSON();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error cambiando contraseña:', error);
      throw new ApiError(500, 'Error cambiando contraseña', 'CHANGE_PASSWORD_ERROR');
    }
  }
}

export const userService = new UserService();
