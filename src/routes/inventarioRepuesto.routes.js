import { Router } from 'express';
import { inventarioRepuestoController } from '../controllers/inventarioRepuesto.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createInventarioRepuestoDto,
  updateInventarioRepuestoDto,
  queryInventarioRepuestoDto,
} from '../dtos/inventarioRepuestoDto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createInventarioRepuestoDto, 'body'), inventarioRepuestoController.create);
router.get('/', validate(queryInventarioRepuestoDto, 'query'), inventarioRepuestoController.list);
router.get('/:id', inventarioRepuestoController.getById);
router.put('/:id', validate(updateInventarioRepuestoDto, 'body'), inventarioRepuestoController.update);
router.patch('/:id', validate(updateInventarioRepuestoDto, 'body'), inventarioRepuestoController.update);
router.delete('/:id', inventarioRepuestoController.delete);

export default router;
