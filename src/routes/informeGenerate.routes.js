import { Router } from 'express';
import { informeGenerateController } from '../controllers/informeGenerate.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { generateInformeDto } from '../dtos/generateInforme.dto.js';

const router = Router();
router.use(authenticate);

router.post('/generate',     validate(generateInformeDto, 'body'), informeGenerateController.generateData.bind(informeGenerateController));
router.post('/generate/pdf', validate(generateInformeDto, 'body'), informeGenerateController.generatePdf.bind(informeGenerateController));

export default router;
