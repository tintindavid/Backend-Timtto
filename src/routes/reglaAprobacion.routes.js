import { Router } from 'express';
import { reglaAprobacionController } from '../controllers/reglaAprobacion.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createReglaAprobacionDto,
  updateReglaAprobacionDto,
  queryReglaAprobacionDto,
} from '../dtos/reglaAprobacion.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';

const router = Router();
router.use(authenticate);

// Gated by the usesRequisiciones capability (CAPABILITY_ROUTE_MAP, blockReads).
router.post('/', authorize(PERMISSIONS.APPROVAL_RULES_CREATE), validate(createReglaAprobacionDto, 'body'), reglaAprobacionController.create);
router.get('/', authorize(PERMISSIONS.APPROVAL_RULES_READ), validate(queryReglaAprobacionDto, 'query'), reglaAprobacionController.list);
router.get('/:id', authorize(PERMISSIONS.APPROVAL_RULES_READ), validate(objectIdParamDto, 'params'), reglaAprobacionController.getById);
router.put('/:id', authorize(PERMISSIONS.APPROVAL_RULES_UPDATE), validate(objectIdParamDto, 'params'), validate(updateReglaAprobacionDto, 'body'), reglaAprobacionController.update);
router.patch('/:id', authorize(PERMISSIONS.APPROVAL_RULES_UPDATE), validate(objectIdParamDto, 'params'), validate(updateReglaAprobacionDto, 'body'), reglaAprobacionController.update);
router.delete('/:id', authorize(PERMISSIONS.APPROVAL_RULES_DELETE), validate(objectIdParamDto, 'params'), reglaAprobacionController.delete);

export default router;
