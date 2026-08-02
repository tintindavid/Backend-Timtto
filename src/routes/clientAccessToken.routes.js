'use strict';
import { Router } from 'express';
import { clientAccessTokenController } from '../controllers/clientAccessToken.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/requireRole.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createClientAccessTokenDto,
  queryClientAccessTokensDto,
} from '../dtos/clientAccessToken.dto.js';

const router = Router();

// Admin-only surface (design spec: role admin, not permission-based).
router.use(authenticate);
router.use(requireRole('admin'));

router.post('/', validate(createClientAccessTokenDto, 'body'), clientAccessTokenController.create);
router.get('/', validate(queryClientAccessTokensDto, 'query'), clientAccessTokenController.list);
router.get('/:id', clientAccessTokenController.getById);
router.patch('/:id/revoke', clientAccessTokenController.revoke);
router.delete('/:id', clientAccessTokenController.softDelete);

export default router;
