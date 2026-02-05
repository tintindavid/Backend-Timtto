import { Router } from 'express';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadLogo, handleMulterError } from '../middlewares/upload.middleware.js';
import { createCustomerDto } from '../dtos/createCustomer.dto.js';
import { updateCustomerDto, updateCustomerDtoAllowUnknown } from '../dtos/updateCustomer.dto.js';
import { queryCustomerDto } from '../dtos/queryCustomer.dto.js';

const router = Router();
router.use(authenticate);

// POST y PUT/PATCH con soporte para multipart/form-data (logo)
router.post('/', uploadLogo, handleMulterError, customerController.create);
router.put('/:id', uploadLogo, handleMulterError, customerController.update);
router.patch('/:id', uploadLogo, handleMulterError, customerController.update);

// Rutas sin archivos
router.get('/', validate(queryCustomerDto, 'query'), customerController.list);
router.get('/:id', customerController.getById);
router.delete('/:id', customerController.delete);

export default router;
