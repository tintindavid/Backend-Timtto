import { Router } from 'express';
import { addressController } from '../controllers/address.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createAddressDto } from '../dtos/createAddress.dto.js';
import { updateAddressDto } from '../dtos/updateAddress.dto.js';
import { queryAddressDto } from '../dtos/queryAddress.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.ADDRESSES_CREATE), validate(createAddressDto, 'body'), addressController.create);
router.get('/', authorize(PERMISSIONS.ADDRESSES_READ), validate(queryAddressDto, 'query'), addressController.list);
router.get('/:id', authorize(PERMISSIONS.ADDRESSES_READ), addressController.getById);
router.put('/:id', authorize(PERMISSIONS.ADDRESSES_UPDATE), validate(updateAddressDto, 'body'), addressController.update);
router.patch('/:id', authorize(PERMISSIONS.ADDRESSES_UPDATE), validate(updateAddressDto, 'body'), addressController.update);
router.delete('/:id', authorize(PERMISSIONS.ADDRESSES_DELETE), addressController.delete);

export default router;
