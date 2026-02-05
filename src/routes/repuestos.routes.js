import { Router } from 'express';
import { repuestosController } from '../controllers/repuestos.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createRepuestosDto } from '../dtos/createRepuestos.dto.js';
import { updateRepuestosDto } from '../dtos/updateRepuestos.dto.js';
import { queryRepuestosDto } from '../dtos/queryRepuestos.dto.js';
import { paramsRepuestosByReportDto } from '../dtos/paramsRepuestosByReport.dto.js';
import { paramsRepuestosByEquipoDto } from '../dtos/paramsRepuestosByEquipo.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createRepuestosDto, 'body'), repuestosController.create);
router.get('/', validate(queryRepuestosDto, 'query'), repuestosController.list);
router.get('/equipo/:equipoId', validate(paramsRepuestosByEquipoDto, 'params'), validate(queryRepuestosDto, 'query'), repuestosController.listByEquipo);
router.get('/reporte/:reportId', validate(paramsRepuestosByReportDto, 'params'), validate(queryRepuestosDto, 'query'), repuestosController.listByReport);
router.get('/:id', repuestosController.getById);
router.put('/:id', validate(updateRepuestosDto, 'body'), repuestosController.update);
router.patch('/:id', validate(updateRepuestosDto, 'body'), repuestosController.update);
router.delete('/:id', repuestosController.delete);

export default router;
