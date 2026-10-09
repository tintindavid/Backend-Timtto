'use strict';
import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/requireRole.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { handleMulterError } from '../middlewares/upload.middleware.js';
import {
  actividadExternaController as c,
  cadenaActividadController as cc,
} from '../controllers/actividadExterna.controller.js';
import {
  createActividadExternaDto,
  updateActividadExternaDto,
  cerrarCadenaDto,
} from '../dtos/actividadExterna.dto.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const actividadExternaRouter = Router({ mergeParams: true });
actividadExternaRouter.use(authenticate);

// Cadenas (read: any authenticated role; close: admin only)
actividadExternaRouter.get('/cadenas-actividad', cc.list);
actividadExternaRouter.get('/cadenas-actividad/:cadenaId', cc.getById);
actividadExternaRouter.patch('/cadenas-actividad/:cadenaId/cerrar', requireRole('admin'), validate(cerrarCadenaDto, 'body'), cc.cerrar);

// Actividades
actividadExternaRouter.get('/actividades-externas', c.list);
actividadExternaRouter.post(
  '/actividades-externas',
  requireRole('admin'),
  upload.single('evidencia'),
  handleMulterError,
  c.parseBody,
  validate(createActividadExternaDto, 'body'),
  c.create,
);
actividadExternaRouter.get('/actividades-externas/:id', c.getById);
actividadExternaRouter.patch(
  '/actividades-externas/:id',
  requireRole('admin'),
  upload.single('evidencia'),
  handleMulterError,
  validate(updateActividadExternaDto, 'body'),
  c.update,
);
actividadExternaRouter.delete('/actividades-externas/:id', requireRole('admin'), c.remove);
actividadExternaRouter.get('/actividades-externas/:id/evidencia/url', c.evidenciaUrl);
actividadExternaRouter.delete('/actividades-externas/:id/evidencia', requireRole('admin'), c.removeEvidencia);

export default actividadExternaRouter;
