import { Router } from 'express';
import { actividadReporteController } from '../controllers/actividadreporte.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createActividadReporteDto } from '../dtos/createActividadReporte.dto.js';
import { updateActividadReporteDto } from '../dtos/updateActividadReporte.dto.js';
import { queryActividadReporteDto } from '../dtos/queryActividadReporte.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createActividadReporteDto, 'body'), actividadReporteController.create);
router.get('/', validate(queryActividadReporteDto, 'query'), actividadReporteController.list);
router.get('/:id', actividadReporteController.getById);
router.put('/:id', validate(updateActividadReporteDto, 'body'), actividadReporteController.update);
router.patch('/:id', validate(updateActividadReporteDto, 'body'), actividadReporteController.update);
router.delete('/:id', actividadReporteController.delete);

export default router;
