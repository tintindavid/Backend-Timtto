import { Router } from 'express';
import { customerNoUsarController } from '../controllers/customerNoUsar.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createCustomerNoUsarDto } from '../dtos/createCustomerNoUsar.dto.js';
import { updateCustomerNoUsarDto } from '../dtos/updateCustomerNoUsar.dto.js';
import { queryCustomerNoUsarDto } from '../dtos/queryCustomerNoUsar.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createCustomerNoUsarDto, 'body'), customerNoUsarController.create);
router.get('/', validate(queryCustomerNoUsarDto, 'query'), customerNoUsarController.list);
router.get('/:id', customerNoUsarController.getById);
router.put('/:id', validate(updateCustomerNoUsarDto, 'body'), customerNoUsarController.update);
router.patch('/:id', validate(updateCustomerNoUsarDto, 'body'), customerNoUsarController.update);
router.delete('/:id', customerNoUsarController.delete);

export default router;
