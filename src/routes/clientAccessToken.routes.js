'use strict';
import { Router } from 'express';
import { clientAccessTokenController } from '../controllers/clientAccessToken.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createClientAccessTokenDto,
  queryClientAccessTokensDto,
} from '../dtos/clientAccessToken.dto.js';

const router = Router();

// Every route requires authentication + the same permission
// PORTAL_CLIENTE_CREAR (2026-08-03). Previously all 5 endpoints were
// gated by requireRole('admin'); the switch lets a tenant admin grant
// the capability to biomedicos or any other role via the roles UI.
// Read/revoke/delete stay under the same permission for simplicity —
// anyone who can issue a token can manage the ones they've issued.
// Admin still receives the permission by default (backfill script for
// existing tenants, PERMISSION_VALUES seed for new tenants).
router.use(authenticate);
router.use(authorize(PERMISSIONS.PORTAL_CLIENTE_CREAR));

router.post('/', validate(createClientAccessTokenDto, 'body'), clientAccessTokenController.create);
router.get('/', validate(queryClientAccessTokensDto, 'query'), clientAccessTokenController.list);
router.get('/:id', clientAccessTokenController.getById);
router.patch('/:id/revoke', clientAccessTokenController.revoke);
router.delete('/:id', clientAccessTokenController.softDelete);

export default router;
