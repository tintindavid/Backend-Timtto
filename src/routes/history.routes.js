'use strict';

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { historyController } from '../controllers/history.controller.js';

const router = Router();

router.use(authenticate);

// Reads are open to any authenticated tenant user. Timeline exposes only
// tenant-scoped data (enforced by the service via applyTenantFilter), and the
// content itself is derived from actions the caller already had permission to
// see (OT/Report/Equipo). No dedicated permission entry keeps the catalog lean.
router.get('/', historyController.listByResource);

export default router;
