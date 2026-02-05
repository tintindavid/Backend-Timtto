import { Router } from 'express';
import { repuestoTrazabilidadController } from '../controllers/repuestotrazabilidad.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createRepuestoTrazabilidadDto } from '../dtos/createRepuestoTrazabilidad.dto.js';
import { updateRepuestoTrazabilidadDto } from '../dtos/updateRepuestoTrazabilidad.dto.js';
import { queryRepuestoTrazabilidadDto } from '../dtos/queryRepuestoTrazabilidad.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createRepuestoTrazabilidadDto, 'body'), repuestoTrazabilidadController.create);
router.get('/', validate(queryRepuestoTrazabilidadDto, 'query'), repuestoTrazabilidadController.list);
router.get('/:id', repuestoTrazabilidadController.getById);
router.put('/:id', validate(updateRepuestoTrazabilidadDto, 'body'), repuestoTrazabilidadController.update);
router.patch('/:id', validate(updateRepuestoTrazabilidadDto, 'body'), repuestoTrazabilidadController.update);
router.delete('/:id', repuestoTrazabilidadController.delete);

export default router;
