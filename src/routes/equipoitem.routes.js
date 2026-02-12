import { Router } from 'express';
import { equipoItemController } from '../controllers/equipoitem.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createEquipoItemDto } from '../dtos/createEquipoItem.dto.js';
import { updateEquipoItemDto } from '../dtos/updateEquipoItem.dto.js';
import { queryEquipoItemDto } from '../dtos/queryEquipoItem.dto.js';
import { updateEquipoSnapshotDto } from '../dtos/updateEquipoSnapshot.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createEquipoItemDto, 'body'), equipoItemController.create);
router.get('/', validate(queryEquipoItemDto, 'query'), equipoItemController.list);

// GET - Obtener equipo con todas las relaciones populadas (debe ir ANTES de /:id)
router.get('/:id/populated', equipoItemController.getByIdPopulated);

router.get('/:id', equipoItemController.getById);
router.put('/:id', validate(updateEquipoItemDto, 'body'), equipoItemController.update);
router.patch('/:id', validate(updateEquipoItemDto, 'body'), equipoItemController.update);
router.put('/:id/snapshot', validate(updateEquipoSnapshotDto, 'body'), equipoItemController.updateSnapshot);
router.delete('/:id', equipoItemController.delete);

export default router;
