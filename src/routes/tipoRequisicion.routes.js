import { Router } from 'express';
import { tipoRequisicionController } from '../controllers/tipoRequisicion.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize, authorizeAny } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createTipoRequisicionDto,
  updateTipoRequisicionDto,
  queryTipoRequisicionDto,
} from '../dtos/tipoRequisicion.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';

const router = Router();
router.use(authenticate);

// Gated by the usesRequisiciones capability (CAPABILITY_ROUTE_MAP, blockReads). Reads are also open to who creates or
// reads requisitions, since they must pick a type.
const canReadTipos = authorizeAny(PERMISSIONS.REQUEST_TYPES_READ, PERMISSIONS.REQUISICIONES_CREATE, PERMISSIONS.REQUISICIONES_READ);

router.post('/', authorize(PERMISSIONS.REQUEST_TYPES_CREATE), validate(createTipoRequisicionDto, 'body'), tipoRequisicionController.create);
router.get('/', canReadTipos, validate(queryTipoRequisicionDto, 'query'), tipoRequisicionController.list);
router.get('/:id', canReadTipos, validate(objectIdParamDto, 'params'), tipoRequisicionController.getById);
router.put('/:id', authorize(PERMISSIONS.REQUEST_TYPES_UPDATE), validate(objectIdParamDto, 'params'), validate(updateTipoRequisicionDto, 'body'), tipoRequisicionController.update);
router.patch('/:id', authorize(PERMISSIONS.REQUEST_TYPES_UPDATE), validate(objectIdParamDto, 'params'), validate(updateTipoRequisicionDto, 'body'), tipoRequisicionController.update);
router.delete('/:id', authorize(PERMISSIONS.REQUEST_TYPES_DELETE), validate(objectIdParamDto, 'params'), tipoRequisicionController.delete);

export default router;
