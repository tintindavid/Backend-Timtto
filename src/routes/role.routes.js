'use strict';

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createRoleDto, updateRoleDto } from '../dtos/role.dto.js';
import { roleController } from '../controllers/role.controller.js';

const router = Router();

router.use(authenticate);

router.get('/', roleController.list);
router.post('/', validate(createRoleDto, 'body'), roleController.create);
router.get('/:id', roleController.getById);
router.put('/:id', validate(updateRoleDto, 'body'), roleController.update);
router.delete('/:id', roleController.softDelete);

export default router;