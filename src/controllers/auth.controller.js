'use strict';
import { userService } from '../services/user.service.js';
import { signToken, verifyToken } from '../utils/jwt.util.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { emailService } from '../services/external/email.service.js';
import { env } from '../config/env.js';

export class AuthController {
  /**
   * POST /api/v1/auth/register — RETIRED (E0, saas-security-baseline).
   *
   * Public self-registration is no longer supported. Tenant bootstrapping is
   * performed by the platform seed script; subsequent users are created by an
   * admin via POST /api/v1/users (authenticated).
   *
   * The route remains registered so clients receive a 410 Gone instead of 404.
   */
  async register(req, res, _next) {
    return res.status(410).json({
      success: false,
      message: 'El registro público ha sido retirado. Use POST /api/v1/users (autenticado) para crear usuarios.',
      error: { code: 'ENDPOINT_RETIRED' },
    });
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const tenantId = req.tenantId;
      const user = await userService.login(email, password, tenantId);
      const token = signToken({ userId: user._id, role: user.role, tenantId: user.tenantId });
      // Include mustChangePassword so the frontend can redirect immediately after login.
      res.json(
        successResponse(
          { user: user.toJSON(), token, mustChangePassword: user.mustChangePassword === true },
          'Login exitoso',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/change-password
   * Authenticated: requires valid JWT (via authenticate middleware).
   * Body: { currentPassword, newPassword }
   *
   * Verifies the current password, hashes the new one, clears mustChangePassword.
   * Returns a refreshed JWT so the client does not need to re-login.
   */
  async changePassword(req, res, next) {
    try {
      const userId = req.user?.userId;
      const tenantId = req.user?.tenantId || req.tenantId;

      if (!userId) throw new ApiError(401, 'No autenticado', 'NO_TOKEN_PROVIDED');
      if (!tenantId) throw new ApiError(401, 'Token inválido: falta tenant', 'INVALID_TOKEN');

      const { currentPassword, newPassword } = req.body;

      const updatedUser = await userService.changePassword(userId, tenantId, currentPassword, newPassword);

      // Issue a fresh token with the same payload (mustChangePassword cleared).
      const newToken = signToken({
        userId: updatedUser._id || userId,
        role: updatedUser.role,
        tenantId: updatedUser.tenantId || tenantId,
      });

      logger.info('AuthController: password changed', { userId });

      return res.status(200).json(
        successResponse({ token: newToken }, 'Contraseña actualizada correctamente'),
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/auth/refresh-token
   * Issues a new JWT preserving all three payload fields: userId, role, tenantId.
   * The previous implementation lost tenantId on refresh — this is the fix.
   */
  async refreshToken(req, res, next) {
    try {
      const { token } = req.body;
      if (!token) throw new ApiError(400, 'Token requerido', 'MISSING_TOKEN');
      const payload = verifyToken(token);
      const newToken = signToken({
        userId: payload.userId,
        role: payload.role,
        tenantId: payload.tenantId,
      });
      res.json(successResponse({ token: newToken }, 'Token refrescado'));
    } catch (error) {
      next(error);
    }
  }

  async me(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new ApiError(401, 'No autenticado', 'NO_TOKEN_PROVIDED');
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!tenantId) throw new ApiError(401, 'Token inválido: falta tenant', 'INVALID_TOKEN');
      const user = await userService.getById(userId, tenantId);
      res.json(successResponse(user, 'Usuario actual'));
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const tenantId = req.tenantId;
      const result = await userService.createPasswordResetToken(email, tenantId);
      if (result) {
        const resetLink = `${env.PUBLIC_APP_URL}/reset-password?token=${result.rawToken}&tenantId=${tenantId}`;
        await emailService.sendForgotPasswordEmail({
          to: result.user.email,
          firstName: result.user.firstName || result.user.email,
          resetLink,
        });
      }
      return res.json(
        successResponse(null, 'Si el email está registrado, recibirás un link de recuperación en los próximos minutos'),
      );
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token, tenantId, newPassword } = req.body;
      await userService.resetPassword(token, tenantId, newPassword);
      return res.json(successResponse(null, 'Contraseña restablecida correctamente'));
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
