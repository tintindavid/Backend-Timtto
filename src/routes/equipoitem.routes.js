import { Router } from 'express';
import { equipoItemController } from '../controllers/equipoitem.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createEquipoItemDto } from '../dtos/createEquipoItem.dto.js';
import { updateEquipoItemDto } from '../dtos/updateEquipoItem.dto.js';
import { queryEquipoItemDto } from '../dtos/queryEquipoItem.dto.js';
import { updateEquipoSnapshotDto } from '../dtos/updateEquipoSnapshot.dto.js';
import { queryEquipoByMesDto } from '../dtos/queryEquipoByMes.dto.js';
import { duplicateCheckEquipoItemDto } from '../dtos/duplicateCheckEquipoItem.dto.js';
import { duplicateCheckBulkEquipoItemDto } from '../dtos/duplicateCheckBulkEquipoItem.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.EQUIPO_ITEMS_CREATE), validate(createEquipoItemDto, 'body'), equipoItemController.create);
router.get('/', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), validate(queryEquipoItemDto, 'query'), equipoItemController.list);
router.get('/mes/:mes', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), validate(queryEquipoByMesDto, 'params'), equipoItemController.getByMesMantenimiento);
// Duplicate pre-check endpoints — registered BEFORE the /:id catch-alls so
// "duplicate-check" is never parsed as an :id (equipo-duplicate-detection-and-replace).
router.get('/duplicate-check', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), validate(duplicateCheckEquipoItemDto, 'query'), equipoItemController.duplicateCheck);
router.post('/duplicate-check/bulk', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), validate(duplicateCheckBulkEquipoItemDto, 'body'), equipoItemController.duplicateCheckBulk);
router.get('/:id/populated', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), equipoItemController.getByIdPopulated);
router.get('/:id', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), equipoItemController.getById);
router.put('/:id', authorize(PERMISSIONS.EQUIPO_ITEMS_UPDATE), validate(updateEquipoItemDto, 'body'), equipoItemController.update);
router.patch('/:id', authorize(PERMISSIONS.EQUIPO_ITEMS_UPDATE), validate(updateEquipoItemDto, 'body'), equipoItemController.update);
router.put('/:id/snapshot', authorize(PERMISSIONS.EQUIPO_ITEMS_UPDATE), validate(updateEquipoSnapshotDto, 'body'), equipoItemController.updateSnapshot);
router.delete('/:id', authorize(PERMISSIONS.EQUIPO_ITEMS_DELETE), equipoItemController.delete);

export default router;
