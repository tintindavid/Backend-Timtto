'use strict';
import { Router } from 'express';
import { equipmentQrController } from '../controllers/equipmentQr.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createEquipmentQrDto,
  bulkGenerateEquipmentQrDto,
  queryEquipmentQrsDto,
  exportPdfBulkQueryDto,
} from '../dtos/equipmentQr.dto.js';

const router = Router();
router.use(authenticate);

// Permission reuse per spec Requirement "Permission reuse service-qrs:*":
// read -> SERVICE_QRS_READ, create/bulk/PDF export -> SERVICE_QRS_CREATE,
// deactivate -> SERVICE_QRS_UPDATE, delete -> SERVICE_QRS_DELETE.
router.get('/', authorize(PERMISSIONS.SERVICE_QRS_READ), validate(queryEquipmentQrsDto, 'query'), equipmentQrController.list);
router.post('/', authorize(PERMISSIONS.SERVICE_QRS_CREATE), validate(createEquipmentQrDto, 'body'), equipmentQrController.create);
router.post(
  '/bulk-generate',
  authorize(PERMISSIONS.SERVICE_QRS_CREATE),
  validate(bulkGenerateEquipmentQrDto, 'body'),
  equipmentQrController.bulkGenerate
);

// export-pdf routes MUST be declared before '/:id' so Express doesn't treat
// "export-pdf" as an :id param.
router.get(
  '/export-pdf',
  authorize(PERMISSIONS.SERVICE_QRS_CREATE),
  validate(exportPdfBulkQueryDto, 'query'),
  equipmentQrController.exportPdfBulk
);
router.get('/export-pdf/:id', authorize(PERMISSIONS.SERVICE_QRS_CREATE), equipmentQrController.exportPdfSingle);

router.get('/:id', authorize(PERMISSIONS.SERVICE_QRS_READ), equipmentQrController.getById);
router.get('/:id/qr-image', authorize(PERMISSIONS.SERVICE_QRS_READ), equipmentQrController.getQrImage);
router.post('/:id/deactivate', authorize(PERMISSIONS.SERVICE_QRS_UPDATE), equipmentQrController.deactivate);
router.delete('/:id', authorize(PERMISSIONS.SERVICE_QRS_DELETE), equipmentQrController.softDelete);

export default router;
