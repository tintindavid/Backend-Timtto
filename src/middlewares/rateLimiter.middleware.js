'use strict';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: 'Demasiadas solicitudes. Por favor intenta nuevamente en 15 minutos',
      error: { code: 'RATE_LIMIT_EXCEEDED', details: { retryAfter: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000) } },
    }),
});
