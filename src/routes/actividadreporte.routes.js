import { Router } from 'express';
import { actividadReporteController } from '../controllers/actividadreporte.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createActividadReporteDto } from '../dtos/createActividadReporte.dto.js';
import { updateActividadReporteDto } from '../dtos/updateActividadReporte.dto.js';
import { queryActividadReporteDto } from '../dtos/queryActividadReporte.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.ACTIVIDAD_REPORTE_CREATE), validate(createActividadReporteDto, 'body'), actividadReporteController.create);
router.get('/', authorize(PERMISSIONS.ACTIVIDAD_REPORTE_READ), validate(queryActividadReporteDto, 'query'), actividadReporteController.list);
router.get('/:id', authorize(PERMISSIONS.ACTIVIDAD_REPORTE_READ), actividadReporteController.getById);
router.put('/:id', authorize(PERMISSIONS.ACTIVIDAD_REPORTE_UPDATE), validate(updateActividadReporteDto, 'body'), actividadReporteController.update);
router.patch('/:id', authorize(PERMISSIONS.ACTIVIDAD_REPORTE_UPDATE), validate(updateActividadReporteDto, 'body'), actividadReporteController.update);
router.delete('/:id', authorize(PERMISSIONS.ACTIVIDAD_REPORTE_DELETE), actividadReporteController.delete);

export default router;
