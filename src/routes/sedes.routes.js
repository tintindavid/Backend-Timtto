import { Router } from 'express';
import { sedesController } from '../controllers/sedes.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createSedesDto } from '../dtos/createSedes.dto.js';
import { updateSedesDto } from '../dtos/updateSedes.dto.js';
import { querySedesDto } from '../dtos/querySedes.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.SEDES_CREATE), validate(createSedesDto, 'body'), sedesController.create);
router.get('/', authorize(PERMISSIONS.SEDES_READ), validate(querySedesDto, 'query'), sedesController.list);
router.get('/:id', authorize(PERMISSIONS.SEDES_READ), sedesController.getById);
router.put('/:id', authorize(PERMISSIONS.SEDES_UPDATE), validate(updateSedesDto, 'body'), sedesController.update);
router.patch('/:id', authorize(PERMISSIONS.SEDES_UPDATE), validate(updateSedesDto, 'body'), sedesController.update);
router.delete('/:id', authorize(PERMISSIONS.SEDES_DELETE), sedesController.delete);

export default router;
