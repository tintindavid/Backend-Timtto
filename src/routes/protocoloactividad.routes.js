import { Router } from 'express';
import { protocoloActividadController } from '../controllers/protocoloactividad.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createProtocoloActividadDto } from '../dtos/createProtocoloActividad.dto.js';
import { updateProtocoloActividadDto } from '../dtos/updateProtocoloActividad.dto.js';
import { queryProtocoloActividadDto } from '../dtos/queryProtocoloActividad.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.PROTOCOLO_ACTIVIDAD_CREATE), validate(createProtocoloActividadDto, 'body'), protocoloActividadController.create);
router.get('/', authorize(PERMISSIONS.PROTOCOLO_ACTIVIDAD_READ), validate(queryProtocoloActividadDto, 'query'), protocoloActividadController.list);
router.get('/:id', authorize(PERMISSIONS.PROTOCOLO_ACTIVIDAD_READ), protocoloActividadController.getById);
router.put('/:id', authorize(PERMISSIONS.PROTOCOLO_ACTIVIDAD_UPDATE), validate(updateProtocoloActividadDto, 'body'), protocoloActividadController.update);
router.patch('/:id', authorize(PERMISSIONS.PROTOCOLO_ACTIVIDAD_UPDATE), validate(updateProtocoloActividadDto, 'body'), protocoloActividadController.update);
router.delete('/:id', authorize(PERMISSIONS.PROTOCOLO_ACTIVIDAD_DELETE), protocoloActividadController.delete);

export default router;
