import { Router } from 'express';
import { informeController } from '../controllers/informe.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createInformeDto } from '../dtos/createInforme.dto.js';
import { updateInformeDto } from '../dtos/updateInforme.dto.js';
import { queryInformeDto } from '../dtos/queryInforme.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createInformeDto, 'body'), informeController.create);
router.get('/', validate(queryInformeDto, 'query'), informeController.list);
router.get('/:id', informeController.getById);
router.put('/:id', validate(updateInformeDto, 'body'), informeController.update);
router.patch('/:id', validate(updateInformeDto, 'body'), informeController.update);
router.delete('/:id', informeController.delete);

export default router;
