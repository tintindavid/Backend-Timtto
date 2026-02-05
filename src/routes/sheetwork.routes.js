import { Router } from 'express';
import { sheetWorkController } from '../controllers/sheetwork.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createSheetWorkDto } from '../dtos/createSheetWork.dto.js';
import { updateSheetWorkDto } from '../dtos/updateSheetWork.dto.js';
import { querySheetWorkDto } from '../dtos/querySheetWork.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createSheetWorkDto, 'body'), sheetWorkController.create);
router.get('/ot/:otId', sheetWorkController.listByOt);
router.get('/', validate(querySheetWorkDto, 'query'), sheetWorkController.list);
router.get('/:id', sheetWorkController.getById);
router.put('/:id', validate(updateSheetWorkDto, 'body'), sheetWorkController.update);
router.patch('/:id', validate(updateSheetWorkDto, 'body'), sheetWorkController.update);
router.delete('/:id', sheetWorkController.delete);

export default router;
