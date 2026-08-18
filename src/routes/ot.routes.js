import { Router } from 'express';
import { oTController } from '../controllers/ot.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createOTDto } from '../dtos/createOT.dto.js';
import { updateOTDto } from '../dtos/updateOT.dto.js';
import { queryOTDto } from '../dtos/queryOT.dto.js';
import { addEquipoToOtDto } from '../dtos/addEquipoToOt.dto.js';
import { setProgramacionOtDto } from '../dtos/setProgramacionOt.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.OTS_CREATE), validate(createOTDto, 'body'), oTController.create);
router.get('/', authorize(PERMISSIONS.OTS_READ), validate(queryOTDto, 'query'), oTController.list);
router.get('/:id', authorize(PERMISSIONS.OTS_READ), oTController.getById);
router.put('/:id', authorize(PERMISSIONS.OTS_UPDATE), validate(updateOTDto, 'body'), oTController.update);
router.patch('/:id', authorize(PERMISSIONS.OTS_UPDATE), validate(updateOTDto, 'body'), oTController.update);
router.post('/:id/equipos', authorize(PERMISSIONS.OTS_UPDATE), validate(addEquipoToOtDto, 'body'), oTController.addEquipos);

// Programación trazable + responsables (ot-responsables-programacion-trazable).
router.post('/:id/programacion', authorize(PERMISSIONS.OTS_MANAGE_RESPONSABLES), validate(setProgramacionOtDto, 'body'), oTController.setProgramacion);
router.get('/:id/programaciones', authorize(PERMISSIONS.OTS_READ), oTController.getProgramaciones);

// Notas — piggyback on OTS_READ/OTS_UPDATE so we don't fragment the catalog.
router.get('/:id/notas', authorize(PERMISSIONS.OTS_READ), oTController.listNotas);
router.post('/:id/notas', authorize(PERMISSIONS.OTS_UPDATE), oTController.addNota);
router.delete('/:id/notas/:notaId', authorize(PERMISSIONS.OTS_UPDATE), oTController.deleteNota);

router.delete('/:id', authorize(PERMISSIONS.OTS_DELETE), oTController.delete);

export default router;
