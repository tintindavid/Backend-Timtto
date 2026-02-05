'use strict';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from './apiError.util.js';
import { logger } from '../config/logger.config.js';

export function signToken(payload = {}) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    logger.info('Verifying token:', token);
    return jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    throw new ApiError(401, 'Token de autenticación inválido o expirado', 'INVALID_TOKEN');
  }
}
