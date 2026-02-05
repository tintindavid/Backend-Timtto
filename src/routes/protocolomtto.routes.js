import { Router } from 'express';
import { protocoloMttoController } from '../controllers/protocolomtto.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createProtocoloMttoDto } from '../dtos/createProtocoloMtto.dto.js';
import { updateProtocoloMttoDto } from '../dtos/updateProtocoloMtto.dto.js';
import { queryProtocoloMttoDto } from '../dtos/queryProtocoloMtto.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createProtocoloMttoDto, 'body'), protocoloMttoController.create);
router.get('/', /*validate(queryProtocoloMttoDto,'query')*/ protocoloMttoController.list);
router.get('/:id', protocoloMttoController.getById);
router.put('/:id', validate(updateProtocoloMttoDto, 'body'), protocoloMttoController.update);
router.patch('/:id', validate(updateProtocoloMttoDto, 'body'), protocoloMttoController.update);
router.delete('/:id', protocoloMttoController.delete);

export default router;
