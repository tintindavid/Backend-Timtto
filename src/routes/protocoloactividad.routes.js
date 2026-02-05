import { Router } from 'express';
import { protocoloActividadController } from '../controllers/protocoloactividad.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createProtocoloActividadDto } from '../dtos/createProtocoloActividad.dto.js';
import { updateProtocoloActividadDto } from '../dtos/updateProtocoloActividad.dto.js';
import { queryProtocoloActividadDto } from '../dtos/queryProtocoloActividad.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createProtocoloActividadDto, 'body'), protocoloActividadController.create);
router.get('/', validate(queryProtocoloActividadDto, 'query'), protocoloActividadController.list);
router.get('/:id', protocoloActividadController.getById);
router.put('/:id', validate(updateProtocoloActividadDto, 'body'), protocoloActividadController.update);
router.patch('/:id', validate(updateProtocoloActividadDto, 'body'), protocoloActividadController.update);
router.delete('/:id', protocoloActividadController.delete);

export default router;
