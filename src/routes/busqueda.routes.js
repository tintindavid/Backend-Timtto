import { Router } from 'express';
import { busquedaController } from '../controllers/busqueda.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { busquedaEquiposQueryDto } from '../dtos/busqueda.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';

/** /api/v1/busqueda/* — every plan; the summary gates each section in its service (change: buscador-equipos). */
const router = Router();
router.use(authenticate);

router.get('/equipos', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), validate(busquedaEquiposQueryDto, 'query'), busquedaController.equipos);
router.get('/equipos/:id/resumen', authorize(PERMISSIONS.EQUIPO_ITEMS_READ), validate(objectIdParamDto, 'params'), busquedaController.resumen);

export default router;
