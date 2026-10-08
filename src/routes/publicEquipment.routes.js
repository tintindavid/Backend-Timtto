'use strict';
import { Router } from 'express';
import { publicEquipmentController } from '../controllers/publicEquipment.controller.js';
import { publicEquipmentReadLimiter } from '../middlewares/rateLimiter.middleware.js';

/**
 * Public equipment QR routes — NO auth (design D4). Mounted at
 * `/api/public/equipo` in app.js, registered alongside the other `/public/*`
 * routers so it is never subject to any route-level `authenticate`
 * middleware (tenantId is resolved from the EquipmentQr doc, never from a
 * header/session — see publicEquipment.service.js / design D6).
 */
const router = Router();

router.get('/:qrToken', publicEquipmentReadLimiter, publicEquipmentController.getHistory);

export default router;
