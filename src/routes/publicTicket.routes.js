'use strict';
import { Router } from 'express';
import { publicTicketController } from '../controllers/publicTicket.controller.js';
import { publicAuth } from '../middlewares/publicAuth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  validateAccessLimiter,
  validateAccessIpLimiter,
  publicTicketCreateLimiter,
} from '../middlewares/rateLimiter.middleware.js';
import { validateAccessDto } from '../dtos/serviceQr.dto.js';
import { createTicketPublicDto } from '../dtos/ticket.dto.js';

const router = Router();

/**
 * Public ticket routes — QR-gated, signed with JWT_PUBLIC_SECRET.
 *
 * Mount layout (per spec):
 *   POST   /validate-access    rate-limited (IP/hour + IP+token/15min) → issues sessionToken
 *   GET    /session/me         requires sessionToken
 *   GET    /equipments         requires sessionToken
 *   POST   /                   requires sessionToken + create-rate-limiter
 *   GET    /list               requires sessionToken (sanitized response)
 *   GET    /:id                requires sessionToken (sanitized response)
 */

// validate-access: order matters — IP-wide limit first (broader), then IP+token.
router.post(
  '/validate-access',
  validateAccessIpLimiter,
  validateAccessLimiter,
  validate(validateAccessDto, 'body'),
  publicTicketController.validateAccess
);

// Everything below requires a valid sessionToken.
router.use(publicAuth);

router.get('/session/me', publicTicketController.sessionMe);
router.get('/equipments', publicTicketController.listEquipments);

router.post(
  '/',
  publicTicketCreateLimiter,
  validate(createTicketPublicDto, 'body'),
  publicTicketController.createTickets
);

router.get('/list', publicTicketController.listTickets);
router.get('/:id', publicTicketController.getTicket);

export default router;
