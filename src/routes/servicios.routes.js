import { Router } from 'express';
import { serviciosController } from '../controllers/servicios.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createServiciosDto } from '../dtos/createServicios.dto.js';
import { updateServiciosDto } from '../dtos/updateServicios.dto.js';
import { queryServiciosDto } from '../dtos/queryServicios.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createServiciosDto, 'body'), serviciosController.create);
router.get('/', validate(queryServiciosDto, 'query'), serviciosController.list);
router.get('/:id', serviciosController.getById);
router.put('/:id', validate(updateServiciosDto, 'body'), serviciosController.update);
router.patch('/:id', validate(updateServiciosDto, 'body'), serviciosController.update);
router.delete('/:id', serviciosController.delete);

export default router;
