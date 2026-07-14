import { Router } from 'express';
import { itemsController } from '../controllers/items.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createItemsDto } from '../dtos/createItems.dto.js';
import { updateItemsDto } from '../dtos/updateItems.dto.js';
import { queryItemsDto } from '../dtos/queryItems.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.ITEMS_CREATE), validate(createItemsDto, 'body'), itemsController.create);
router.get('/', authorize(PERMISSIONS.ITEMS_READ), validate(queryItemsDto, 'query'), itemsController.list);
router.get('/:id', authorize(PERMISSIONS.ITEMS_READ), itemsController.getById);
router.put('/:id', authorize(PERMISSIONS.ITEMS_UPDATE), validate(updateItemsDto, 'body'), itemsController.update);
router.patch('/:id', authorize(PERMISSIONS.ITEMS_UPDATE), validate(updateItemsDto, 'body'), itemsController.update);
router.delete('/:id', authorize(PERMISSIONS.ITEMS_DELETE), itemsController.delete);

export default router;
