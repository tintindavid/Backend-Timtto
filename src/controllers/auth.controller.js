'use strict';
import { userService } from '../services/user.service.js';
import { Tenant } from '../models/tenant.model.js';
import { signToken, verifyToken } from '../utils/jwt.util.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export class AuthController {
  async register(req, res, next) {
    try {
      const body = { ...req.body, tenantId: req.tenantId || req.body.tenantId };
      const user = await userService.create(body);
      const token = signToken({ userId: user._id, role: user.role, tenantId: user.tenantId });
      res.status(201).json(successResponse({ user, token }, 'Usuario registrado exitosamente', 201));
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      logger.info('Login request body', { body: req.body });
      logger.debug && logger.debug('AuthController.login reached');
      const { email, password } = req.body;
      const tenantId = req.tenantId || req.body.tenantId;
      // DEBUG: list tenants to inspect DB contents when debugging TENANT_NOT_FOUND
      try {
        const tenants = await Tenant.find().select('tenantId name isDeleted').lean();
        logger.info('AuthController.login: tenants snapshot', { count: tenants.length, sample: tenants.slice(0, 10) });
      } catch (te) {
        logger.debug && logger.debug('AuthController.login: tenant list failed', { err: String(te) });
      }
      const user = await userService.login(email, password, tenantId);
      const token = signToken({ userId: user._id, role: user.role, tenantId: user.tenantId });
      res.json(successResponse({ user: user.toJSON(), token }, 'Login exitoso'));
    } catch (error) {
      logger.error('Login error', { error: error && error.message ? error.message : error });
      next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { token } = req.body;
      if (!token) throw new ApiError(400, 'Token requerido', 'MISSING_TOKEN');
      const payload = verifyToken(token);
      const newToken = signToken({ userId: payload.userId, role: payload.role });
      res.json(successResponse({ token: newToken }, 'Token refrescado'));
    } catch (error) {
      next(error);
    }
  }

  async me(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new ApiError(401, 'No autenticado', 'NO_TOKEN_PROVIDED');
      const user = await userService.getById(userId);
      res.json(successResponse(user, 'Usuario actual'));
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
