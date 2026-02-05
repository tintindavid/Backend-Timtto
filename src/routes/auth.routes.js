'use strict';
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { loginUserDto } from '../dtos/loginUser.dto.js';
import { createUserDto } from '../dtos/createUser.dto.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

// Public
router.post('/register', validate(createUserDto, 'body'), authController.register);
router.post('/login', validate(loginUserDto, 'body'), authController.login);
router.post('/refresh-token', authController.refreshToken);

// Protected
router.get('/me', authenticate, authController.me);

export default router;
