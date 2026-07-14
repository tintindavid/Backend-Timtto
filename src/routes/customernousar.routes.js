import { Router } from 'express';
import { customerNoUsarController } from '../controllers/customernousar.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createCustomerNoUsarDto } from '../dtos/createCustomerNoUsar.dto.js';
import { updateCustomerNoUsarDto } from '../dtos/updateCustomerNoUsar.dto.js';
import { queryCustomerNoUsarDto } from '../dtos/queryCustomerNoUsar.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.CUSTOMERS_CREATE), validate(createCustomerNoUsarDto, 'body'), customerNoUsarController.create);
router.get('/', authorize(PERMISSIONS.CUSTOMERS_READ), validate(queryCustomerNoUsarDto, 'query'), customerNoUsarController.list);
router.get('/:id', authorize(PERMISSIONS.CUSTOMERS_READ), customerNoUsarController.getById);
router.put('/:id', authorize(PERMISSIONS.CUSTOMERS_UPDATE), validate(updateCustomerNoUsarDto, 'body'), customerNoUsarController.update);
router.patch('/:id', authorize(PERMISSIONS.CUSTOMERS_UPDATE), validate(updateCustomerNoUsarDto, 'body'), customerNoUsarController.update);
router.delete('/:id', authorize(PERMISSIONS.CUSTOMERS_DELETE), customerNoUsarController.delete);

export default router;
