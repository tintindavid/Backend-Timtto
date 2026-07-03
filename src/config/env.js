'use strict';
import dotenv from 'dotenv';
dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/timtto',
  JWT_SECRET: process.env.JWT_SECRET || 'replace_with_secure_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  // Public sessionToken (QR-gated /public/tickets/*) — MUST differ from JWT_SECRET.
  // The startup assertion in config/jwt.config.js refuses to boot if they match.
  JWT_PUBLIC_SECRET: process.env.JWT_PUBLIC_SECRET || '',
  JWT_PUBLIC_EXPIRES_IN: process.env.JWT_PUBLIC_EXPIRES_IN || '2h',
  // QR PNG persistence
  QR_IMAGE_STORAGE_PATH: process.env.QR_IMAGE_STORAGE_PATH || 'uploads/qr',
  PUBLIC_APP_BASE_URL: process.env.PUBLIC_APP_BASE_URL || 'http://localhost:5173',
  // CORS origins: allow frontend dev server in development
  CORS_ORIGINS: (() => {
    const fromEnv = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [];
    if ((process.env.NODE_ENV || 'development') === 'development') {
      // ensure Vite dev server origin is allowed during development
      return Array.from(new Set([...fromEnv, 'http://localhost:3000', 'http://localhost:5173']));
    }
    return fromEnv.length ? fromEnv : ['http://localhost:3000'];
  })(),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 100),
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  // Feature flag: when true, tenantResolver blocks requests for suspended/closed tenants.
  // Deploy with false, activate after 7-day observation window (design D3).
  ENFORCE_TENANT_STATUS: process.env.ENFORCE_TENANT_STATUS === 'true',
  // Microservicio PDF
  PDF_SERVICE_URL: process.env.PDF_SERVICE_URL || 'https://html-to-pdf-service-production-a1f8.up.railway.app',
  PDF_MICROSERVICE_TIMEOUT: Number(process.env.PDF_MICROSERVICE_TIMEOUT || 30000),
  // E3 — Notificaciones de email transaccional (Resend SMTP)
  // Deploy con NOTIFICATIONS_ENABLED=false (default). Activar tras verificar
  // que el dominio timtto.com está verificado en Resend y las credenciales SMTP son válidas.
  NOTIFICATIONS_ENABLED: process.env.NOTIFICATIONS_ENABLED === 'true',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.resend.com',
  SMTP_PORT: Number(process.env.SMTP_PORT || 465),
  SMTP_USER: process.env.SMTP_USER || 'resend',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS || 'AlertasyNotificaciones@timtto.com',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'TIMTTO Alertas y Notificaciones',
  // URL pública del frontend — se usa en los links del email (ej. /login)
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || 'http://localhost:5173',
};
