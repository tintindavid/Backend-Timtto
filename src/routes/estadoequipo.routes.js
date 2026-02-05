import { Router } from 'express';
import { estadoEquipoController } from '../controllers/estadoequipo.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createEstadoEquipoDto } from '../dtos/createEstadoEquipo.dto.js';
import { updateEstadoEquipoDto } from '../dtos/updateEstadoEquipo.dto.js';
import { queryEstadoEquipoDto } from '../dtos/queryEstadoEquipo.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createEstadoEquipoDto, 'body'), estadoEquipoController.create);
router.get('/', validate(queryEstadoEquipoDto, 'query'), estadoEquipoController.list);
router.get('/:id', estadoEquipoController.getById);
router.put('/:id', validate(updateEstadoEquipoDto, 'body'), estadoEquipoController.update);
router.patch('/:id', validate(updateEstadoEquipoDto, 'body'), estadoEquipoController.update);
router.delete('/:id', estadoEquipoController.delete);

export default router;
