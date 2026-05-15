import { EventEmitter } from 'events';

// Aumentar límite de listeners si es necesario
EventEmitter.defaultMaxListeners = 15;

'use strict';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';

import { env } from './config/env.js';
import { logger, loggerStream } from './config/logger.config.js';
import { rateLimiter } from './middlewares/rateLimiter.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { tenantResolver } from './middlewares/tenant.middleware.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import actividadMttoRoutes from './routes/actividadmtto.routes.js';
import actividadReporteRoutes from './routes/actividadreporte.routes.js';
import addressRoutes from './routes/address.routes.js';
import customerRoutes from './routes/customer.routes.js';
import customerNoUsarRoutes from './routes/customernousar.routes.js';
import equipoItemRoutes from './routes/equipoitem.routes.js';
import estadoEquipoRoutes from './routes/estadoequipo.routes.js';
import hvEquipoRoutes from './routes/hvequipo.routes.js';
import informeRoutes from './routes/informe.routes.js';
import informeGenerateRoutes from './routes/informeGenerate.routes.js';
import itemsRoutes from './routes/items.routes.js';
import otRoutes from './routes/ot.routes.js';
import protocoloActividadRoutes from './routes/protocoloactividad.routes.js';
import protocoloMttoRoutes from './routes/protocolomtto.routes.js';
import reportRoutes from './routes/report.routes.js';
import repuestosRoutes from './routes/repuestos.routes.js';
import repuestoTrazabilidadRoutes from './routes/repuestotrazabilidad.routes.js';
import sedesRoutes from './routes/sedes.routes.js';
import serviciosRoutes from './routes/servicios.routes.js';
import sheetworkRoutes from './routes/sheetwork.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import pdfReportsRoutes from './routes/pdfReports.routes.js';
import cronogramaRoutes from './routes/cronograma.routes.js';

import { successResponse } from './utils/apiResponse.util.js';

const app = express();

// Respect reverse proxies (e.g. Railway, Heroku). Enable in production or when
// explicitly configured via TRUST_PROXY env var.
// Respect reverse proxies (e.g. Railway, Heroku).
// Use a numeric value (number of trusted proxies) or an explicit value from
// `TRUST_PROXY` to avoid permissive boolean true which express-rate-limit
// rejects for security reasons.
const _trustProxyEnv = process.env.TRUST_PROXY;
let trustProxyValue = false;
if (typeof _trustProxyEnv !== 'undefined' && _trustProxyEnv !== '') {
  if (_trustProxyEnv === 'true') trustProxyValue = 1; // treat 'true' as 1
  else if (!Number.isNaN(Number(_trustProxyEnv))) trustProxyValue = Number(_trustProxyEnv);
  else trustProxyValue = _trustProxyEnv; // allow values like 'loopback'
} else {
  trustProxyValue = env.NODE_ENV === 'production' ? 1 : false;
}
app.set('trust proxy', trustProxyValue);

app.use(helmet());

// CORS configuration: must be before routes
const corsOrigins = process.env.CORS_ORIGIN?.split(',') || process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'];
const corsOptions = {
  origin: corsOrigins,
  credentials: true,
  optionsSuccessStatus: 200,
};

logger.info(`CORS enabled for origins: ${corsOrigins.join(', ')}`);

app.use(cors(corsOptions));
// allow preflight for all routes
app.options('*', cors(corsOptions));

app.use(rateLimiter);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

// Resolve tenant for each request (from header or JWT)
app.use(tenantResolver);

app.use(morgan('combined', { stream: loggerStream }));

// Mount generated routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
// app.use('/api/v1/equipos', equipoRoutes); // Comentar si no existe
// app.use('/api/v1/hvequipos', hvequipoRoutes); // Comentar si no existe
app.use('/api/v1/cronogramas', cronogramaRoutes); // Nueva ruta
app.use('/api/v1/actividad-mtto', actividadMttoRoutes);
app.use('/api/v1/actividad-reporte', actividadReporteRoutes);
app.use('/api/v1/address', addressRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/customer-no-usar', customerNoUsarRoutes);
app.use('/api/v1/equipo-items', equipoItemRoutes);
app.use('/api/v1/estado-equipo', estadoEquipoRoutes);
app.use('/api/v1/hv-equipo', hvEquipoRoutes);
app.use('/api/v1/informes', informeRoutes);
app.use('/api/v1/informes', informeGenerateRoutes);
app.use('/api/v1/items', itemsRoutes);
app.use('/api/v1/ots', otRoutes);
app.use('/api/v1/protocolo-actividad', protocoloActividadRoutes);
app.use('/api/v1/protocolo-mtto', protocoloMttoRoutes);
app.use('/api/v1/reports', reportRoutes);
// Alias in Spanish for backwards compatibility / frontend convenience
app.use('/api/v1/reportes', reportRoutes);
app.use('/api/v1/repuestos', repuestosRoutes);
app.use('/api/v1/repuesto-trazabilidad', repuestoTrazabilidadRoutes);
app.use('/api/v1/sedes', sedesRoutes);
app.use('/api/v1/servicios', serviciosRoutes);
app.use('/api/v1/sheetwork', sheetworkRoutes);
// Alias for english/plural endpoint used by frontend
app.use('/api/v1/worksheets', sheetworkRoutes);
// Tenant management
app.use('/api/v1/tenants', tenantRoutes);
// PDF reports (bulk/single)
app.use('/api/v1/pdf-reports', pdfReportsRoutes);

// Health check
app.get('/api/v1/health', (_req, res) => res.json(successResponse({ uptime: process.uptime() }, 'OK')));

// 404
app.use((_req, res) =>
  res.status(404).json({
    success: false,
    message: 'Not Found',
    error: { code: 'NOT_FOUND' },
  })
);

// Error handler
app.use(errorHandler);

export default app;
