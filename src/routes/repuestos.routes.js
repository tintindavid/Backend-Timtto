import { Router } from 'express';
import { repuestosController } from '../controllers/repuestos.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createRepuestosDto } from '../dtos/createRepuestos.dto.js';
import { updateRepuestosDto } from '../dtos/updateRepuestos.dto.js';
import { queryRepuestosDto } from '../dtos/queryRepuestos.dto.js';
import { paramsRepuestosByReportDto } from '../dtos/paramsRepuestosByReport.dto.js';
import { paramsRepuestosByEquipoDto } from '../dtos/paramsRepuestosByEquipo.dto.js';
import { createOtFromSolicitudesDto } from '../dtos/createOtFromSolicitudes.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.REPUESTOS_CREATE), validate(createRepuestosDto, 'body'), repuestosController.create);
router.post('/ot-from-solicitudes', authorize(PERMISSIONS.REPUESTOS_CREATE), validate(createOtFromSolicitudesDto, 'body'), repuestosController.createOtFromSolicitudes);
router.get('/', authorize(PERMISSIONS.REPUESTOS_READ), validate(queryRepuestosDto, 'query'), repuestosController.list);
router.get('/equipo/:equipoId/all', authorize(PERMISSIONS.REPUESTOS_READ), validate(paramsRepuestosByEquipoDto, 'params'), validate(queryRepuestosDto, 'query'), repuestosController.listByEquipoAll);
router.get('/equipo/:equipoId', authorize(PERMISSIONS.REPUESTOS_READ), validate(paramsRepuestosByEquipoDto, 'params'), validate(queryRepuestosDto, 'query'), repuestosController.listByEquipo);
router.get('/reporte/:reportId', authorize(PERMISSIONS.REPUESTOS_READ), validate(paramsRepuestosByReportDto, 'params'), validate(queryRepuestosDto, 'query'), repuestosController.listByReport);
router.get('/:id', authorize(PERMISSIONS.REPUESTOS_READ), repuestosController.getById);
router.put('/:id', authorize(PERMISSIONS.REPUESTOS_UPDATE), validate(updateRepuestosDto, 'body'), repuestosController.update);
router.patch('/:id', authorize(PERMISSIONS.REPUESTOS_UPDATE), validate(updateRepuestosDto, 'body'), repuestosController.update);
router.delete('/:id', authorize(PERMISSIONS.REPUESTOS_DELETE), repuestosController.delete);

export default router;
