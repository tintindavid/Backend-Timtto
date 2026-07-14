import { Router } from 'express';
import { hVEquipoController } from '../controllers/hvequipo.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createHVEquipoDto } from '../dtos/createHVEquipo.dto.js';
import { updateHVEquipoDto } from '../dtos/updateHVEquipo.dto.js';
import { queryHVEquipoDto } from '../dtos/queryHVEquipo.dto.js';
import { queryHVEquipoAprobadasParamsDto, queryHVEquipoAprobadasQueryDto } from '../dtos/queryHVEquipoAprobadas.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.HV_EQUIPOS_CREATE), validate(createHVEquipoDto, 'body'), hVEquipoController.create);
router.get('/', authorize(PERMISSIONS.HV_EQUIPOS_READ), validate(queryHVEquipoDto, 'query'), hVEquipoController.list);

router.get(
  '/aprobadas/:marca/:modelo',
  authorize(PERMISSIONS.HV_EQUIPOS_READ),
  validate(queryHVEquipoAprobadasParamsDto, 'params'),
  validate(queryHVEquipoAprobadasQueryDto, 'query'),
  hVEquipoController.listApproved,
);

router.get('/equipo/:equipoId', authorize(PERMISSIONS.HV_EQUIPOS_READ), hVEquipoController.getByEquipoId);
router.get('/:id/pdf', authorize(PERMISSIONS.HV_EQUIPOS_PDF), hVEquipoController.downloadPDF);

router.get('/:id', authorize(PERMISSIONS.HV_EQUIPOS_READ), hVEquipoController.getById);
router.put('/:id', authorize(PERMISSIONS.HV_EQUIPOS_UPDATE), validate(updateHVEquipoDto, 'body'), hVEquipoController.update);
router.patch('/:id', authorize(PERMISSIONS.HV_EQUIPOS_UPDATE), validate(updateHVEquipoDto, 'body'), hVEquipoController.update);
router.delete('/:id', authorize(PERMISSIONS.HV_EQUIPOS_DELETE), hVEquipoController.delete);

export default router;
