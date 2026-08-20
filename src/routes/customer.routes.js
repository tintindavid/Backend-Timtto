import { Router } from 'express';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadLogo, handleMulterError } from '../middlewares/upload.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createCustomerDto } from '../dtos/createCustomer.dto.js';
import { updateCustomerDto, updateCustomerDtoAllowUnknown } from '../dtos/updateCustomer.dto.js';
import { queryCustomerDto } from '../dtos/queryCustomer.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.CUSTOMERS_CREATE), uploadLogo, handleMulterError, customerController.create);
router.put('/:id', authorize(PERMISSIONS.CUSTOMERS_UPDATE), uploadLogo, handleMulterError, customerController.update);
router.patch('/:id', authorize(PERMISSIONS.CUSTOMERS_UPDATE), uploadLogo, handleMulterError, customerController.update);

router.get('/', authorize(PERMISSIONS.CUSTOMERS_READ), validate(queryCustomerDto, 'query'), customerController.list);
// CSV export must be registered BEFORE the generic /:id route so the literal
// "export" segment isn't parsed as an ObjectId.
router.get('/export', authorize(PERMISSIONS.CUSTOMERS_READ), customerController.exportCsv);
// Download inventory is intentionally gated only by the generic
// `customers:read` permission — no dedicated permission required. Anyone
// who can view customers can export their equipo inventory.
router.get('/:id/inventario', authorize(PERMISSIONS.CUSTOMERS_READ), customerController.downloadInventario);
router.get('/:id', authorize(PERMISSIONS.CUSTOMERS_READ), customerController.getById);
router.delete('/:id', authorize(PERMISSIONS.CUSTOMERS_DELETE), customerController.delete);

export default router;
