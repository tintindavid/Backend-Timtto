import { Router } from 'express';
import { reportController } from '../controllers/report.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { uploadEvidencias, handleMulterError } from '../middlewares/upload.middleware.js';
import { createReportDto } from '../dtos/createReport.dto.js';
import { updateReportDto } from '../dtos/updateReport.dto.js';
import { processReportDto } from '../dtos/processReport.dto.js';
import { queryReportDto } from '../dtos/queryReport.dto.js';
import { paramsReportByOtDto } from '../dtos/paramsReportByOt.dto.js';
import { updateVerificationParamsDto } from '../dtos/updateVerificationParams.dto.js';
import { addExtraActividadesDto } from '../dtos/addExtraActividades.dto.js';
import { downloadReportPDF } from '../controllers/pdfReports.controller.js';

const router = Router();
router.use(authenticate);

router.post('/', authorize(PERMISSIONS.REPORTS_CREATE), validate(createReportDto, 'body'), reportController.create);
router.get('/', authorize(PERMISSIONS.REPORTS_READ), validate(queryReportDto, 'query'), reportController.list);

// GET - Listar reports por OT
router.get('/ot/:otId', authorize(PERMISSIONS.REPORTS_READ), validate(paramsReportByOtDto, 'params'), validate(queryReportDto, 'query'), reportController.listByOt);

// GET - Listar reports por Equipo (debe ir ANTES de /:id)
router.get('/equipo/:equipoId', authorize(PERMISSIONS.REPORTS_READ), validate(queryReportDto, 'query'), reportController.listByEquipo);

// Verification parameters templates + history — registered BEFORE /:id
router.get('/verification-params/suggest', authorize(PERMISSIONS.REPORTS_READ), reportController.suggestVerificationParams);
router.get('/verification-params/history', authorize(PERMISSIONS.REPORTS_READ), reportController.historyVerificationParams);

router.get('/:id/pdf', authorize(PERMISSIONS.REPORTS_PDF), downloadReportPDF);
router.get('/:id', authorize(PERMISSIONS.REPORTS_READ), reportController.getById);
router.put('/:reporteId/procesar', authorize(PERMISSIONS.REPORTS_UPDATE), validate(processReportDto, 'body'), reportController.procesar);
router.put('/:reporteId/unprocess', authorize(PERMISSIONS.REPORTS_UPDATE), reportController.unprocess);

// Evidence endpoints (registered before generic /:id to avoid route shadowing)
router.post(
  '/:reporteId/evidencias',
  authorize(PERMISSIONS.REPORTS_UPDATE),
  uploadEvidencias,
  handleMulterError,
  (req, res, next) => reportController.uploadEvidencias(req, res, next)
);
router.patch(
  '/:reporteId/evidencias/:evidenciaId',
  authorize(PERMISSIONS.REPORTS_UPDATE),
  (req, res, next) => reportController.updateEvidencia(req, res, next)
);
router.delete(
  '/:reporteId/evidencias/:evidenciaId',
  authorize(PERMISSIONS.REPORTS_UPDATE),
  (req, res, next) => reportController.deleteEvidencia(req, res, next)
);

// Verification parameters endpoint (registered before generic /:id to avoid route shadowing)
router.patch(
  '/:reporteId/verification-params',
  authorize(PERMISSIONS.REPORTS_UPDATE),
  validate(updateVerificationParamsDto, 'body'),
  (req, res, next) => reportController.updateVerificationParams(req, res, next)
);

// Extra activities endpoints (report-actividades-extra) — registered BEFORE
// generic /:id to avoid route shadowing. Both reuse REPORTS_UPDATE since the
// action is semantically part of editing the report; no new permission
// required (design D6, RBAC section).
router.post(
  '/:reporteId/actividades-extra',
  authorize(PERMISSIONS.REPORTS_UPDATE),
  validate(addExtraActividadesDto, 'body'),
  (req, res, next) => reportController.addExtraActividades(req, res, next)
);
router.delete(
  '/:reporteId/actividades-extra/:actividadRealizadaId',
  authorize(PERMISSIONS.REPORTS_UPDATE),
  (req, res, next) => reportController.removeExtraActividad(req, res, next)
);

router.put('/:id', authorize(PERMISSIONS.REPORTS_UPDATE), validate(updateReportDto, 'body'), reportController.update);
router.patch('/:id', authorize(PERMISSIONS.REPORTS_UPDATE), validate(updateReportDto, 'body'), reportController.update);
router.delete('/:id', authorize(PERMISSIONS.REPORTS_DELETE), reportController.delete);

export default router;
