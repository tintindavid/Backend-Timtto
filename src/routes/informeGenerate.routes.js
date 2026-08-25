import { Router } from 'express';
import { informeGenerateController } from '../controllers/informeGenerate.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { generateInformeDto } from '../dtos/generateInforme.dto.js';
import { informeGenerateByOtDto } from '../dtos/informeGenerateByOt.dto.js';

const router = Router();
router.use(authenticate);

router.post('/generate',     authorize(PERMISSIONS.INFORMES_GENERATE), validate(generateInformeDto, 'body'), informeGenerateController.generateData.bind(informeGenerateController));
router.post('/generate/pdf', authorize(PERMISSIONS.INFORMES_GENERATE), validate(generateInformeDto, 'body'), informeGenerateController.generatePdf.bind(informeGenerateController));
router.post('/por-ot',       authorize(PERMISSIONS.INFORMES_GENERATE), validate(informeGenerateByOtDto, 'body'), informeGenerateController.generateByOt.bind(informeGenerateController));
router.post('/por-ot/pdf',   authorize(PERMISSIONS.INFORMES_GENERATE), validate(informeGenerateByOtDto, 'body'), informeGenerateController.downloadPdfByOt.bind(informeGenerateController));

export default router;
