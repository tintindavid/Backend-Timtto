'use strict';
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { loginUserDto } from '../dtos/loginUser.dto.js';
import { createUserDto } from '../dtos/createUser.dto.js';
import { changePasswordSchema } from '../dtos/changePassword.dto.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { forgotPasswordSchema } from '../dtos/forgotPassword.dto.js';
import { resetPasswordSchema } from '../dtos/resetPassword.dto.js';

const router = Router();

// Public
router.post('/register', validate(createUserDto, 'body'), authController.register);
router.post('/login', validate(loginUserDto, 'body'), authController.login);
router.post('/refresh-token', authController.refreshToken);

// Protected
router.get('/me', authenticate, authController.me);

/**
 * POST /api/v1/auth/change-password
 * Requires valid JWT. Accepts { currentPassword, newPassword }.
 * Clears mustChangePassword flag on success. Returns a fresh token.
 * This route is explicitly exempt from the enforceMustChangePassword global guard.
 */
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

// Self-service password recovery — public
router.get('/validate-reset-token', authController.validateResetToken);
router.post('/forgot-password', validate(forgotPasswordSchema, 'body'), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema, 'body'), authController.resetPassword);

export default router;
