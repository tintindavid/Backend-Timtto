import { Router } from 'express';
import { sedesController } from '../controllers/sedes.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createSedesDto } from '../dtos/createSedes.dto.js';
import { updateSedesDto } from '../dtos/updateSedes.dto.js';
import { querySedesDto } from '../dtos/querySedes.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createSedesDto, 'body'), sedesController.create);
router.get('/', validate(querySedesDto, 'query'), sedesController.list);
router.get('/:id', sedesController.getById);
router.put('/:id', validate(updateSedesDto, 'body'), sedesController.update);
router.patch('/:id', validate(updateSedesDto, 'body'), sedesController.update);
router.delete('/:id', sedesController.delete);

export default router;
