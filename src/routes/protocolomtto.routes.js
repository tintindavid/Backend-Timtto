import { Router } from 'express';
import { protocoloMttoController } from '../controllers/protocolomtto.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createProtocoloMttoDto } from '../dtos/createProtocoloMtto.dto.js';
import { updateProtocoloMttoDto } from '../dtos/updateProtocoloMtto.dto.js';
import { queryProtocoloMttoDto } from '../dtos/queryProtocoloMtto.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.PROTOCOLO_MTTO_CREATE), validate(createProtocoloMttoDto, 'body'), protocoloMttoController.create);
router.get('/', authorize(PERMISSIONS.PROTOCOLO_MTTO_READ), /*validate(queryProtocoloMttoDto,'query')*/ protocoloMttoController.list);
router.get('/:id', authorize(PERMISSIONS.PROTOCOLO_MTTO_READ), protocoloMttoController.getById);
router.put('/:id', authorize(PERMISSIONS.PROTOCOLO_MTTO_UPDATE), validate(updateProtocoloMttoDto, 'body'), protocoloMttoController.update);
router.patch('/:id', authorize(PERMISSIONS.PROTOCOLO_MTTO_UPDATE), validate(updateProtocoloMttoDto, 'body'), protocoloMttoController.update);
router.delete('/:id', authorize(PERMISSIONS.PROTOCOLO_MTTO_DELETE), protocoloMttoController.delete);

export default router;
