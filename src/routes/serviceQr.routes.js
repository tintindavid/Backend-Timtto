'use strict';
import { Router } from 'express';
import { serviceQrController } from '../controllers/serviceQr.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createServiceQrDto,
  rotateServiceQrPasswordDto,
  queryServiceQrsDto,
} from '../dtos/serviceQr.dto.js';

const router = Router();
router.use(authenticate);

router.get('/', validate(queryServiceQrsDto, 'query'), serviceQrController.list);
router.post('/', validate(createServiceQrDto, 'body'), serviceQrController.create);

router.get('/:id', serviceQrController.getById);
router.get('/:id/qr-image', serviceQrController.getQrImage);
router.patch(
  '/:id/rotate-password',
  validate(rotateServiceQrPasswordDto, 'body'),
  serviceQrController.rotatePassword
);
router.patch('/:id/deactivate', serviceQrController.deactivate);
router.patch('/:id/activate', serviceQrController.activate);
router.delete('/:id', serviceQrController.softDelete);

export default router;
