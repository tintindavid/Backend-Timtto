import { Router } from 'express';
import { informeController } from '../controllers/informe.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createInformeDto } from '../dtos/createInforme.dto.js';
import { updateInformeDto } from '../dtos/updateInforme.dto.js';
import { queryInformeDto } from '../dtos/queryInforme.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.INFORMES_CREATE), validate(createInformeDto, 'body'), informeController.create);
router.get('/', authorize(PERMISSIONS.INFORMES_READ), validate(queryInformeDto, 'query'), informeController.list);
router.get('/:id', authorize(PERMISSIONS.INFORMES_READ), informeController.getById);
router.put('/:id', authorize(PERMISSIONS.INFORMES_UPDATE), validate(updateInformeDto, 'body'), informeController.update);
router.patch('/:id', authorize(PERMISSIONS.INFORMES_UPDATE), validate(updateInformeDto, 'body'), informeController.update);
router.delete('/:id', authorize(PERMISSIONS.INFORMES_DELETE), informeController.delete);

export default router;
