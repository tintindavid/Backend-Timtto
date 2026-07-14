'use strict';

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createRoleDto, updateRoleDto } from '../dtos/role.dto.js';
import { roleController } from '../controllers/role.controller.js';

const router = Router();

router.use(authenticate);

router.get('/', authorize(PERMISSIONS.ROLES_READ), roleController.list);
router.post('/', authorize(PERMISSIONS.ROLES_CREATE), validate(createRoleDto, 'body'), roleController.create);
router.get('/:id', authorize(PERMISSIONS.ROLES_READ), roleController.getById);
router.put('/:id', authorize(PERMISSIONS.ROLES_UPDATE), validate(updateRoleDto, 'body'), roleController.update);
router.delete('/:id', authorize(PERMISSIONS.ROLES_DELETE), roleController.softDelete);

export default router;
