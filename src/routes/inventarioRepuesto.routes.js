import { Router } from 'express';
import { inventarioRepuestoController } from '../controllers/inventarioRepuesto.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createInventarioRepuestoDto,
  updateInventarioRepuestoDto,
  queryInventarioRepuestoDto,
} from '../dtos/inventarioRepuestoDto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.INVENTARIO_CREATE), validate(createInventarioRepuestoDto, 'body'), inventarioRepuestoController.create);
router.get('/', authorize(PERMISSIONS.INVENTARIO_READ), validate(queryInventarioRepuestoDto, 'query'), inventarioRepuestoController.list);
router.get('/:id', authorize(PERMISSIONS.INVENTARIO_READ), inventarioRepuestoController.getById);
router.put('/:id', authorize(PERMISSIONS.INVENTARIO_UPDATE), validate(updateInventarioRepuestoDto, 'body'), inventarioRepuestoController.update);
router.patch('/:id', authorize(PERMISSIONS.INVENTARIO_UPDATE), validate(updateInventarioRepuestoDto, 'body'), inventarioRepuestoController.update);
router.delete('/:id', authorize(PERMISSIONS.INVENTARIO_DELETE), inventarioRepuestoController.delete);

export default router;
