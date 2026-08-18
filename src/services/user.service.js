'use strict';
import crypto from 'crypto';
import { User } from '../models/user.model.js';
import { Role } from '../models/role.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { hashPassword, comparePassword } from '../utils/password.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { generateTemporaryPassword } from '../utils/temporaryPassword.util.js';
import { emailService } from './external/email.service.js';
import { env } from '../config/env.js';

export class UserService {
  async create(data) {
    try {
      const tenantId = data.tenantId;
      requireTenant(tenantId);

      if (data.roleId) {
        const role = await Role.findOne({ _id: data.roleId, tenantId, isDeleted: false });
        if (!role) throw new ApiError(404, 'Rol no encontrado', 'ROLE_NOT_FOUND', { roleId: data.roleId });
      }

      // Uniqueness by (tenantId, email) is enforced by a compound unique index
      // in the model, but we pre-check so the caller gets a friendly 409 with
      // an actionable message instead of a bare "duplicate key" error.
      const exists = await User.findOne({ tenantId, email: data.email });
      if (exists) throw new ApiError(409, 'El email ya está registrado para este tenant', 'EMAIL_ALREADY_EXISTS', { email: data.email });

      // Generate a temporary password when the client didn't provide one — the
      // panel now creates personnel via /users without asking for a password,
      // and we email the temp so the user can log in and rotate it.
      const clientPassword = typeof data.password === 'string' && data.password.trim().length > 0 ? data.password : null;
      const temporaryPassword = clientPassword ? null : generateTemporaryPassword();

      const userPayload = {
        ...data,
        password: clientPassword || temporaryPassword,
        mustChangePassword: temporaryPassword !== null,
      };

      const user = await User.create(userPayload);
      logger.info(`User creado: ${user._id}`);

      let emailSent = false;
      if (temporaryPassword) {
        // Fire-and-forget: we don't want a slow SMTP to block the API response.
        // The caller sees the temp password in the payload as a fallback.
        try {
          const tenant = await Tenant.findOne({ tenantId }).lean();
          await emailService.sendWelcomeEmail({
            to: user.email,
            tenantName: tenant?.name || tenantId,
            tenantId,
            adminFirstName: user.firstName || 'Usuario',
            temporaryPassword,
            loginUrl: `${env.PUBLIC_APP_URL || ''}/login`,
          });
          emailSent = env.NOTIFICATIONS_ENABLED === true;
        } catch (err) {
          logger.error('user.create: welcome email failed', { userId: user._id, error: err?.message });
        }
      }

      return {
        user: user.toJSON(),
        temporaryPassword,
        emailSent,
      };
    } catch (error) {
      logger.error('Error creando user:', error);
      if (error instanceof ApiError) throw error;
      if (error?.code === 11000) {
        throw new ApiError(409, 'El email ya está registrado para este tenant', 'EMAIL_ALREADY_EXISTS', { email: data.email });
      }
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
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        order = 'desc',
        search,
        name,
        email,
        role,
        roleId,
        hasFirma,
        permission,
      } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);

      // Eligibility filter (ot-responsables-programacion-trazable, D9) —
      // resolve which tenant roles carry `permission`, then scope to users
      // holding one of those roles. Short-circuits to an empty page when no
      // role matches, same pattern as the `clienteName` lookup in
      // ot.service.js#list.
      if (permission) {
        const eligibleRoles = await Role.find({ tenantId, isDeleted: false, permissions: permission })
          .select('_id')
          .lean();
        if (eligibleRoles.length === 0) {
          return {
            data: [],
            pagination: { page, limit, total: 0, pages: 0, hasNext: false, hasPrev: page > 1 },
          };
        }
        query.roleId = { $in: eligibleRoles.map((r) => r._id) };
      }

      const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (search) {
        const regex = new RegExp(escapeRegex(search), 'i');
        query.$or = [{ firstName: regex }, { lastName: regex }, { email: regex }, { username: regex }];
      }
      if (name) {
        const regex = new RegExp(escapeRegex(name), 'i');
        // AND with $or so combining `name` and `email` narrows the result set
        // instead of widening it — server-side filters must compose safely.
        const nameOr = [{ firstName: regex }, { lastName: regex }, { fullName: regex }];
        query.$and = [...(query.$and || []), { $or: nameOr }];
      }
      if (email) {
        query.email = new RegExp(escapeRegex(email), 'i');
      }
      if (role) query.role = role;
      if (roleId) query.roleId = roleId;
      if (hasFirma === true) {
        query.fileFirma = { $exists: true, $nin: [null, ''] };
      } else if (hasFirma === false) {
        query.$or = [
          ...(query.$or || []),
          { fileFirma: { $exists: false } },
          { fileFirma: null },
          { fileFirma: '' },
        ];
      }

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

  async createPasswordResetToken(email, tenantId) {
    try {
      requireTenant(tenantId);
      const user = await User.findOne({ email, tenantId });
      if (!user) return null;
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.passwordResetToken = tokenHash;
      user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      logger.info('UserService: passwordReset token created', { userId: user._id });
      return { rawToken, user };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error creando password reset token:', error);
      throw new ApiError(500, 'Error procesando solicitud', 'RESET_TOKEN_ERROR');
    }
  }

  async findValidResetToken(rawToken, tenantId) {
    try {
      requireTenant(tenantId);
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const user = await User.findOne({
        passwordResetToken: tokenHash,
        passwordResetExpires: { $gt: new Date() },
        tenantId,
      });
      return !!user;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error validando reset token:', error);
      throw new ApiError(500, 'Error validando token', 'VALIDATE_TOKEN_ERROR');
    }
  }

  async resetPassword(rawToken, tenantId, newPassword) {
    try {
      requireTenant(tenantId);
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const user = await User.findOne({
        passwordResetToken: tokenHash,
        passwordResetExpires: { $gt: new Date() },
        tenantId,
      });
      if (!user) throw new ApiError(400, 'Token inválido o expirado', 'TOKEN_INVALID_OR_EXPIRED');
      user.password = newPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.mustChangePassword = false;
      await user.save();
      logger.info('UserService: password reset successful', { userId: user._id });
      return user.toJSON();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error en resetPassword:', error);
      throw new ApiError(500, 'Error al restablecer contraseña', 'RESET_PASSWORD_ERROR');
    }
  }
}

export const userService = new UserService();
