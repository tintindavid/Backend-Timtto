import { Router } from 'express';
import { hVEquipoController } from '../controllers/hVEquipo.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createHVEquipoDto } from '../dtos/createHVEquipo.dto.js';
import { updateHVEquipoDto } from '../dtos/updateHVEquipo.dto.js';
import { queryHVEquipoDto } from '../dtos/queryHVEquipo.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createHVEquipoDto, 'body'), hVEquipoController.create);
router.get('/', validate(queryHVEquipoDto, 'query'), hVEquipoController.list);
router.get('/:id', hVEquipoController.getById);
router.put('/:id', validate(updateHVEquipoDto, 'body'), hVEquipoController.update);
router.patch('/:id', validate(updateHVEquipoDto, 'body'), hVEquipoController.update);
router.delete('/:id', hVEquipoController.delete);

export default router;
