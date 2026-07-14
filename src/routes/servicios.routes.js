import { Router } from 'express';
import { serviciosController } from '../controllers/servicios.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createServiciosDto } from '../dtos/createServicios.dto.js';
import { updateServiciosDto } from '../dtos/updateServicios.dto.js';
import { queryServiciosDto } from '../dtos/queryServicios.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.SERVICIOS_CREATE), validate(createServiciosDto, 'body'), serviciosController.create);
router.get('/', authorize(PERMISSIONS.SERVICIOS_READ), validate(queryServiciosDto, 'query'), serviciosController.list);
router.get('/:id', authorize(PERMISSIONS.SERVICIOS_READ), serviciosController.getById);
router.put('/:id', authorize(PERMISSIONS.SERVICIOS_UPDATE), validate(updateServiciosDto, 'body'), serviciosController.update);
router.patch('/:id', authorize(PERMISSIONS.SERVICIOS_UPDATE), validate(updateServiciosDto, 'body'), serviciosController.update);
router.delete('/:id', authorize(PERMISSIONS.SERVICIOS_DELETE), serviciosController.delete);

export default router;
