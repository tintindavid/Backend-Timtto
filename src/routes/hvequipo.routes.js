import { Router } from 'express';
import { hVEquipoController } from '../controllers/hvequipo.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createHVEquipoDto } from '../dtos/createHVEquipo.dto.js';
import { updateHVEquipoDto } from '../dtos/updateHVEquipo.dto.js';
import { queryHVEquipoDto } from '../dtos/queryHVEquipo.dto.js';
import { queryHVEquipoAprobadasParamsDto, queryHVEquipoAprobadasQueryDto } from '../dtos/queryHVEquipoAprobadas.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createHVEquipoDto, 'body'), hVEquipoController.create);
router.get('/', validate(queryHVEquipoDto, 'query'), hVEquipoController.list);

// GET - List aprobadas by Marca y Modelo (debe ir ANTES de /:id para evitar conflictos)
router.get(
  '/aprobadas/:marca/:modelo', 
  validate(queryHVEquipoAprobadasParamsDto, 'params'),
  validate(queryHVEquipoAprobadasQueryDto, 'query'),
  hVEquipoController.listApproved
);

// GET - Obtener HVEquipos por EquipoId (debe ir ANTES de /:id)
router.get('/equipo/:equipoId', hVEquipoController.getByEquipoId);

// GET - Generar y descargar PDF de HV (debe ir ANTES de /:id)
router.get('/:id/pdf', hVEquipoController.downloadPDF);

router.get('/:id', hVEquipoController.getById);
router.put('/:id', validate(updateHVEquipoDto, 'body'), hVEquipoController.update);
router.patch('/:id', validate(updateHVEquipoDto, 'body'), hVEquipoController.update);
router.delete('/:id', hVEquipoController.delete);

export default router;
