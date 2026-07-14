'use strict';
import { Router } from 'express';
import { serviceQrController } from '../controllers/serviceQr.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createServiceQrDto,
  rotateServiceQrPasswordDto,
  queryServiceQrsDto,
} from '../dtos/serviceQr.dto.js';

const router = Router();
router.use(authenticate);

router.get('/', authorize(PERMISSIONS.SERVICE_QRS_READ), validate(queryServiceQrsDto, 'query'), serviceQrController.list);
router.post('/', authorize(PERMISSIONS.SERVICE_QRS_CREATE), validate(createServiceQrDto, 'body'), serviceQrController.create);

router.get('/:id', authorize(PERMISSIONS.SERVICE_QRS_READ), serviceQrController.getById);
router.get('/:id/qr-image', authorize(PERMISSIONS.SERVICE_QRS_READ), serviceQrController.getQrImage);
router.patch(
  '/:id/rotate-password',
  authorize(PERMISSIONS.SERVICE_QRS_UPDATE),
  validate(rotateServiceQrPasswordDto, 'body'),
  serviceQrController.rotatePassword,
);
router.patch('/:id/deactivate', authorize(PERMISSIONS.SERVICE_QRS_UPDATE), serviceQrController.deactivate);
router.patch('/:id/activate', authorize(PERMISSIONS.SERVICE_QRS_UPDATE), serviceQrController.activate);
router.delete('/:id', authorize(PERMISSIONS.SERVICE_QRS_DELETE), serviceQrController.softDelete);

export default router;
