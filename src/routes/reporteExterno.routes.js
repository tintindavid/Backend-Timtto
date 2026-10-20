'use strict';
import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { handleMulterError } from '../middlewares/upload.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { reporteExternoController as c } from '../controllers/reporteExterno.controller.js';
import { createReporteExternoDto } from '../dtos/reporteExterno.dto.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Services done by a third party (reportes-externos-mp-mc). Mounted under /api/v1/equipos/:equipoId, a common
 * prefix: the capability `registersExternal` is asserted by the service, not by the work-order route map.
 */
export const reporteExternoRouter = Router({ mergeParams: true });
reporteExternoRouter.use(authenticate);

reporteExternoRouter.post(
  '/reportes-externos',
  authorize(PERMISSIONS.REPORTS_CREATE),
  upload.single('documento'),
  handleMulterError,
  c.parseBody,
  validate(createReporteExternoDto, 'body'),
  c.create,
);

reporteExternoRouter.delete(
  '/reportes-externos/:id',
  authorize(PERMISSIONS.REPORTS_DELETE),
  c.remove,
);

export default reporteExternoRouter;
