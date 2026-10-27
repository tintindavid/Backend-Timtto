import { Router } from 'express';
import { presupuestoAreaController } from '../controllers/presupuestoArea.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize, authorizeAny } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createPresupuestoAreaDto,
  updatePresupuestoAreaDto,
  queryPresupuestoAreaDto,
  resumenPresupuestoDto,
} from '../dtos/presupuestoArea.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';

const router = Router();
router.use(authenticate);

// Gated by the usesRequisiciones capability (CAPABILITY_ROUTE_MAP, blockReads).
router.post('/', authorize(PERMISSIONS.BUDGETS_CREATE), validate(createPresupuestoAreaDto, 'body'), presupuestoAreaController.create);
router.get('/', authorize(PERMISSIONS.BUDGETS_READ), validate(queryPresupuestoAreaDto, 'query'), presupuestoAreaController.list);
// Declared before '/:id'. Approvers see the area budget in the approval panel, so approve also grants this read.
router.get(
  '/resumen',
  authorizeAny(PERMISSIONS.BUDGETS_READ, PERMISSIONS.REQUISICIONES_APPROVE),
  validate(resumenPresupuestoDto, 'query'),
  presupuestoAreaController.resumen,
);
router.get('/:id', authorize(PERMISSIONS.BUDGETS_READ), validate(objectIdParamDto, 'params'), presupuestoAreaController.getById);
router.put('/:id', authorize(PERMISSIONS.BUDGETS_UPDATE), validate(objectIdParamDto, 'params'), validate(updatePresupuestoAreaDto, 'body'), presupuestoAreaController.update);
router.patch('/:id', authorize(PERMISSIONS.BUDGETS_UPDATE), validate(objectIdParamDto, 'params'), validate(updatePresupuestoAreaDto, 'body'), presupuestoAreaController.update);
router.delete('/:id', authorize(PERMISSIONS.BUDGETS_DELETE), validate(objectIdParamDto, 'params'), presupuestoAreaController.delete);

export default router;
