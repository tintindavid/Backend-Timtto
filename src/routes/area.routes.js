import { Router } from 'express';
import { areaController } from '../controllers/area.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize, authorizeAny } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createAreaDto, updateAreaDto, queryAreaDto } from '../dtos/area.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';

const router = Router();
router.use(authenticate);

// Gated by the usesRequisiciones capability (CAPABILITY_ROUTE_MAP, blockReads). Reads are also open to who creates or
// reads requisitions, since they must pick an area.
const canReadAreas = authorizeAny(PERMISSIONS.AREAS_READ, PERMISSIONS.REQUISICIONES_CREATE, PERMISSIONS.REQUISICIONES_READ);

router.post('/', authorize(PERMISSIONS.AREAS_CREATE), validate(createAreaDto, 'body'), areaController.create);
router.get('/', canReadAreas, validate(queryAreaDto, 'query'), areaController.list);
router.get('/:id', canReadAreas, validate(objectIdParamDto, 'params'), areaController.getById);
router.put('/:id', authorize(PERMISSIONS.AREAS_UPDATE), validate(objectIdParamDto, 'params'), validate(updateAreaDto, 'body'), areaController.update);
router.patch('/:id', authorize(PERMISSIONS.AREAS_UPDATE), validate(objectIdParamDto, 'params'), validate(updateAreaDto, 'body'), areaController.update);
router.delete('/:id', authorize(PERMISSIONS.AREAS_DELETE), validate(objectIdParamDto, 'params'), areaController.delete);

export default router;
