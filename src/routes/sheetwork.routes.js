import { Router } from 'express';
import { sheetWorkController } from '../controllers/sheetwork.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createSheetWorkDto } from '../dtos/createSheetWork.dto.js';
import { updateSheetWorkDto } from '../dtos/updateSheetWork.dto.js';
import { querySheetWorkDto } from '../dtos/querySheetWork.dto.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.SHEETWORK_CREATE), validate(createSheetWorkDto, 'body'), sheetWorkController.create);
router.get('/ot/:otId', authorize(PERMISSIONS.SHEETWORK_READ), sheetWorkController.listByOt);
router.get('/', authorize(PERMISSIONS.SHEETWORK_READ), validate(querySheetWorkDto, 'query'), sheetWorkController.list);

// Ruta para generar PDF (debe ir ANTES de /:id para evitar conflictos)
router.get('/:id/pdf', authorize(PERMISSIONS.SHEETWORK_READ), sheetWorkController.generatePDF);

router.get('/:id', authorize(PERMISSIONS.SHEETWORK_READ), sheetWorkController.getById);

// Admin retro-mitigation (sheet-report-closure spec): closes only the
// Procesado reports linked to this sheet. Same permission as other
// sheet-mutating routes (no granular "sheetwork:close-reports" permission
// exists yet).
router.post('/:sheetId/close-reports', authorize(PERMISSIONS.SHEETWORK_UPDATE), sheetWorkController.closeReports);

router.put('/:id', authorize(PERMISSIONS.SHEETWORK_UPDATE), validate(updateSheetWorkDto, 'body'), sheetWorkController.update);
router.patch('/:id', authorize(PERMISSIONS.SHEETWORK_UPDATE), validate(updateSheetWorkDto, 'body'), sheetWorkController.update);
router.delete('/:id', authorize(PERMISSIONS.SHEETWORK_DELETE), sheetWorkController.delete);

export default router;
