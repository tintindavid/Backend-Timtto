import { Router } from 'express';
import { estadoEquipoController } from '../controllers/estadoequipo.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createEstadoEquipoDto } from '../dtos/createEstadoEquipo.dto.js';
import { updateEstadoEquipoDto } from '../dtos/updateEstadoEquipo.dto.js';
import { queryEstadoEquipoDto } from '../dtos/queryEstadoEquipo.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.ESTADO_EQUIPO_CREATE), validate(createEstadoEquipoDto, 'body'), estadoEquipoController.create);
router.get('/', authorize(PERMISSIONS.ESTADO_EQUIPO_READ), validate(queryEstadoEquipoDto, 'query'), estadoEquipoController.list);
router.get('/:id', authorize(PERMISSIONS.ESTADO_EQUIPO_READ), estadoEquipoController.getById);
router.put('/:id', authorize(PERMISSIONS.ESTADO_EQUIPO_UPDATE), validate(updateEstadoEquipoDto, 'body'), estadoEquipoController.update);
router.patch('/:id', authorize(PERMISSIONS.ESTADO_EQUIPO_UPDATE), validate(updateEstadoEquipoDto, 'body'), estadoEquipoController.update);
router.delete('/:id', authorize(PERMISSIONS.ESTADO_EQUIPO_DELETE), estadoEquipoController.delete);

export default router;
