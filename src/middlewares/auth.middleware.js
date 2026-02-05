'use strict';
import { verifyToken } from '../utils/jwt.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization || req.headers.Authorization;

  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Token de autenticación requerido', 'NO_TOKEN_PROVIDED'));
  }

  const token = header.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    return next();
  } catch (err) {
    return next(err);
  }
}
