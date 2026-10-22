import { Router } from 'express';
import { inventarioMovimientoController } from '../controllers/inventarioMovimiento.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createInventarioMovimientoDto,
  queryInventarioMovimientoDto,
} from '../dtos/inventarioMovimientoDto.js';

const router = Router();
router.use(authenticate);

// Movements are immutable: no PUT/PATCH/DELETE. Gated by the usesInventoryAdvanced capability (CAPABILITY_ROUTE_MAP).
router.get('/', authorize(PERMISSIONS.INVENTARIO_READ), validate(queryInventarioMovimientoDto, 'query'), inventarioMovimientoController.list);
router.post('/', authorize(PERMISSIONS.INVENTARIO_UPDATE), validate(createInventarioMovimientoDto, 'body'), inventarioMovimientoController.create);

export default router;
