import { Router } from 'express';
import { oTController } from '../controllers/oT.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createOTDto } from '../dtos/createOT.dto.js';
import { updateOTDto } from '../dtos/updateOT.dto.js';
import { queryOTDto } from '../dtos/queryOT.dto.js';
import { addEquipoToOtDto } from '../dtos/addEquipoToOt.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(createOTDto, 'body'), oTController.create);
router.get('/', validate(queryOTDto, 'query'), oTController.list);
router.get('/:id', oTController.getById);
router.put('/:id', validate(updateOTDto, 'body'), oTController.update);
router.patch('/:id', validate(updateOTDto, 'body'), oTController.update);
router.post('/:id/equipos', validate(addEquipoToOtDto, 'body'), oTController.addEquipos);
router.delete('/:id', oTController.delete);

export default router;
