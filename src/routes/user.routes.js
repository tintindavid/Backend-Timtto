'use strict';
import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createUserDto } from '../dtos/createUser.dto.js';
import { updateUserDto } from '../dtos/updateUser.dto.js';
import { queryUserDto } from '../dtos/queryUser.dto.js';
import { assignUserRoleDto } from '../dtos/assignUserRole.dto.js';

const router = Router();

router.use(authenticate);

router.post('/', authorize(PERMISSIONS.USERS_CREATE), validate(createUserDto, 'body'), userController.create);
router.get('/', authorize(PERMISSIONS.USERS_READ), validate(queryUserDto, 'query'), userController.list);
router.get('/:id', authorize(PERMISSIONS.USERS_READ), userController.getById);
router.put('/:id', authorize(PERMISSIONS.USERS_UPDATE), validate(updateUserDto, 'body'), userController.update);
router.patch('/:id', authorize(PERMISSIONS.USERS_UPDATE), validate(updateUserDto, 'body'), userController.update);
router.patch('/:id/role', authorize(PERMISSIONS.USERS_ASSIGN_ROLE), validate(assignUserRoleDto, 'body'), userController.assignRole);
router.delete('/:id', authorize(PERMISSIONS.USERS_DELETE), userController.delete);

export default router;
