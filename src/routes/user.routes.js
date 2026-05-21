'use strict';
import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createUserDto } from '../dtos/createUser.dto.js';
import { updateUserDto } from '../dtos/updateUser.dto.js';
import { queryUserDto } from '../dtos/queryUser.dto.js';
import { assignUserRoleDto } from '../dtos/assignUserRole.dto.js';

const router = Router();

// All routes protected
router.use(authenticate);

// POST - Create
router.post('/', validate(createUserDto, 'body'), userController.create);

// GET - List
router.get('/', validate(queryUserDto, 'query'), userController.list);

// GET - GetById
router.get('/:id', userController.getById);

// PUT - Update (full)
router.put('/:id', validate(updateUserDto, 'body'), userController.update);

// PATCH - Update (partial)
router.patch('/:id', validate(updateUserDto, 'body'), userController.update);

// PATCH - Assign role
router.patch('/:id/role', validate(assignUserRoleDto, 'body'), userController.assignRole);

// DELETE - Soft Delete
router.delete('/:id', userController.delete);

export default router;
