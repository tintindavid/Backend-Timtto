import { Router } from 'express';
import { TenantController } from '../controllers/tenant.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { uploadLogoOptional, handleMulterError } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createTenantSchema } from '../dtos/createTenant.dto.js';
import { updateTenantSchema } from '../dtos/updateTenant.dto.js';

const router = Router();

// Rutas públicas o con autenticación básica (con soporte para logo)
router.post('/', uploadLogoOptional, handleMulterError, TenantController.create);

// Rutas para SuperAdmin (sin restricción de tenant)
router.get('/superadmin/all', authenticate, requireSuperAdmin, TenantController.listAllForSuperAdmin);
router.get('/superadmin/:id', authenticate, requireSuperAdmin, TenantController.getAnyTenant);

// Rutas normales (con autenticación y restricción de tenant)
router.get('/', authenticate, TenantController.list);
router.get('/:id', authenticate, TenantController.get);
router.put('/:id', authenticate, uploadLogoOptional, handleMulterError, TenantController.update);
router.delete('/:id', authenticate, TenantController.remove);

export default router;
