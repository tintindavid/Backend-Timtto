import { Router } from 'express';
import { repuestoTrazabilidadController } from '../controllers/repuestotrazabilidad.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createRepuestoTrazabilidadDto } from '../dtos/createRepuestoTrazabilidad.dto.js';
import { updateRepuestoTrazabilidadDto } from '../dtos/updateRepuestoTrazabilidad.dto.js';
import { queryRepuestoTrazabilidadDto } from '../dtos/queryRepuestoTrazabilidad.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.REPUESTO_TRAZABILIDAD_CREATE), validate(createRepuestoTrazabilidadDto, 'body'), repuestoTrazabilidadController.create);
router.get('/', authorize(PERMISSIONS.REPUESTO_TRAZABILIDAD_READ), validate(queryRepuestoTrazabilidadDto, 'query'), repuestoTrazabilidadController.list);
router.get('/:id', authorize(PERMISSIONS.REPUESTO_TRAZABILIDAD_READ), repuestoTrazabilidadController.getById);
router.put('/:id', authorize(PERMISSIONS.REPUESTO_TRAZABILIDAD_UPDATE), validate(updateRepuestoTrazabilidadDto, 'body'), repuestoTrazabilidadController.update);
router.patch('/:id', authorize(PERMISSIONS.REPUESTO_TRAZABILIDAD_UPDATE), validate(updateRepuestoTrazabilidadDto, 'body'), repuestoTrazabilidadController.update);
router.delete('/:id', authorize(PERMISSIONS.REPUESTO_TRAZABILIDAD_DELETE), repuestoTrazabilidadController.delete);

export default router;
