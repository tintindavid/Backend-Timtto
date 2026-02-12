import { Router } from 'express';
import { reportController } from '../controllers/report.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createReportDto } from '../dtos/createReport.dto.js';
import { updateReportDto } from '../dtos/updateReport.dto.js';
import { processReportDto } from '../dtos/processReport.dto.js';
import { queryReportDto } from '../dtos/queryReport.dto.js';
import { paramsReportByOtDto } from '../dtos/paramsReportByOt.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createReportDto, 'body'), reportController.create);
router.get('/', validate(queryReportDto, 'query'), reportController.list);

// GET - Listar reports por OT
router.get('/ot/:otId', validate(paramsReportByOtDto, 'params'), validate(queryReportDto, 'query'), reportController.listByOt);

// GET - Listar reports por Equipo (debe ir ANTES de /:id)
router.get('/equipo/:equipoId', validate(queryReportDto, 'query'), reportController.listByEquipo);

router.get('/:id', reportController.getById);
router.put('/:reporteId/procesar', validate(processReportDto, 'body'), reportController.procesar);
router.put('/:id', validate(updateReportDto, 'body'), reportController.update);
router.patch('/:id', validate(updateReportDto, 'body'), reportController.update);
router.delete('/:id', reportController.delete);

export default router;
