import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { dashboardQueryDto } from '../dtos/dashboard.dto.js';

/**
 * /api/v1/dashboard/* — any authenticated user of the tenant (no new permission; change
 * dashboard-por-tenant-indicadores). Tickets/requisitions sections check their own permission inside the service.
 */
const router = Router();
router.use(authenticate);

const query = validate(dashboardQueryDto, 'query');

router.get('/cumplimiento', query, dashboardController.cumplimiento);
router.get('/equipos-periodo', query, dashboardController.equiposPeriodo);
router.get('/mis-cifras', query, dashboardController.misCifras);
router.get('/ranking', query, dashboardController.ranking);
router.get('/items', query, dashboardController.items);
router.get('/tiempos', query, dashboardController.tiempos);
router.get('/operativos', query, dashboardController.operativos);
router.get('/alertas', query, dashboardController.alertas);

export default router;
