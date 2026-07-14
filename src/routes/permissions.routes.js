'use strict';

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { PERMISSIONS, PERMISSIONS_BY_RESOURCE } from '../constants/permissions.js';

const router = Router();

router.use(authenticate);

router.get('/', (_req, res) => {
  res.json(
    successResponse(
      { flat: PERMISSIONS, grouped: PERMISSIONS_BY_RESOURCE },
      'Permisos recuperados exitosamente',
    ),
  );
});

export default router;