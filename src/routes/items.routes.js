import { Router } from 'express';
import { itemsController } from '../controllers/items.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createItemsDto } from '../dtos/createItems.dto.js';
import { updateItemsDto } from '../dtos/updateItems.dto.js';
import { queryItemsDto } from '../dtos/queryItems.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createItemsDto, 'body'), itemsController.create);
router.get('/', validate(queryItemsDto, 'query'), itemsController.list);
router.get('/:id', itemsController.getById);
router.put('/:id', validate(updateItemsDto, 'body'), itemsController.update);
router.patch('/:id', validate(updateItemsDto, 'body'), itemsController.update);
router.delete('/:id', itemsController.delete);

export default router;
