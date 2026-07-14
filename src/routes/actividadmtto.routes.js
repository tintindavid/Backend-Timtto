import { Router } from 'express';
import { actividadMttoController } from '../controllers/actividadmtto.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createActividadMttoDto } from '../dtos/createActividadMtto.dto.js';
import { updateActividadMttoDto } from '../dtos/updateActividadMtto.dto.js';
import { queryActividadMttoDto } from '../dtos/queryActividadMtto.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.ACTIVIDAD_MTTO_CREATE), validate(createActividadMttoDto, 'body'), actividadMttoController.create);
router.get('/', authorize(PERMISSIONS.ACTIVIDAD_MTTO_READ), validate(queryActividadMttoDto, 'query'), actividadMttoController.list);
router.get('/search', authorize(PERMISSIONS.ACTIVIDAD_MTTO_READ), actividadMttoController.searchByName);
router.get('/:id', authorize(PERMISSIONS.ACTIVIDAD_MTTO_READ), actividadMttoController.getById);
router.put('/:id', authorize(PERMISSIONS.ACTIVIDAD_MTTO_UPDATE), validate(updateActividadMttoDto, 'body'), actividadMttoController.update);
router.patch('/:id', authorize(PERMISSIONS.ACTIVIDAD_MTTO_UPDATE), validate(updateActividadMttoDto, 'body'), actividadMttoController.update);
router.delete('/:id', authorize(PERMISSIONS.ACTIVIDAD_MTTO_DELETE), actividadMttoController.delete);

export default router;
