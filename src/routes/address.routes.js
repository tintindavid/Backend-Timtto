import { Router } from 'express';
import { addressController } from '../controllers/address.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createAddressDto } from '../dtos/createAddress.dto.js';
import { updateAddressDto } from '../dtos/updateAddress.dto.js';
import { queryAddressDto } from '../dtos/queryAddress.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createAddressDto, 'body'), addressController.create);
router.get('/', validate(queryAddressDto, 'query'), addressController.list);
router.get('/:id', addressController.getById);
router.put('/:id', validate(updateAddressDto, 'body'), addressController.update);
router.patch('/:id', validate(updateAddressDto, 'body'), addressController.update);
router.delete('/:id', addressController.delete);

export default router;
