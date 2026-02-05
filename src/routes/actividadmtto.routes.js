import { Router } from 'express';
import { actividadMttoController } from '../controllers/actividadMtto.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createActividadMttoDto } from '../dtos/createActividadMtto.dto.js';
import { updateActividadMttoDto } from '../dtos/updateActividadMtto.dto.js';
import { queryActividadMttoDto } from '../dtos/queryActividadMtto.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createActividadMttoDto, 'body'), actividadMttoController.create);
router.get('/', validate(queryActividadMttoDto, 'query'), actividadMttoController.list);
router.get('/:id', actividadMttoController.getById);
router.put('/:id', validate(updateActividadMttoDto, 'body'), actividadMttoController.update);
router.patch('/:id', validate(updateActividadMttoDto, 'body'), actividadMttoController.update);
router.delete('/:id', actividadMttoController.delete);

export default router;
