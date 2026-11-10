import { requisicionTableroService } from '../services/requisicionTablero.service.js';
import { requisicionMetricasService } from '../services/requisicionMetricas.service.js';
import { requisicionExportService } from '../services/requisicionExport.service.js';
import { userCanReadRequisiciones } from '../middlewares/requisicionReadAccess.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { successResponse } from '../utils/apiResponse.util.js';

/** Binding only: req -> service -> res. Tenant and identity always come from the token chain, never the query. */
const hasPerm = (req, p) => req.user?.role === 'superadmin'
  || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(p));

const canManageAll = (req) => hasPerm(req, PERMISSIONS.REQUISICIONES_MANAGE_ALL);
const canReceive = (req) => canManageAll(req) || hasPerm(req, PERMISSIONS.REQUISICIONES_RECEIVE);

const caps = (req) => req.tenant?.capabilities;

/** Blob response: the file name was built by the service from the sanitized consecutivo only. */
function sendFile(res, { buffer, contentType, filename }) {
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.status(200).send(buffer);
}

const detailActor = (req) => ({
  user: req.user,
  userId: req.user?.userId,
  canRead: userCanReadRequisiciones(req.user),
  canApprovePo: hasPerm(req, PERMISSIONS.REQUISICIONES_APPROVE_PO),
});

export class RequisicionReporteController {
  async tablero(req, res, next) {
    try {
      const data = await requisicionTableroService.obtener(req.tenantId, req.user.userId, {
        canReceive: canReceive(req),
        canManageAll: canManageAll(req),
        canApprovePo: hasPerm(req, PERMISSIONS.REQUISICIONES_APPROVE_PO),
        canReports: hasPerm(req, PERMISSIONS.REQUISICIONES_REPORTS),
        canRead: userCanReadRequisiciones(req.user),
      });
      res.json(successResponse(data, 'Tablero recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async metricas(req, res, next) {
    try {
      const data = await requisicionMetricasService.obtener(req.tenantId, req.query);
      res.json(successResponse(data, 'Métricas recuperadas exitosamente'));
    } catch (err) { next(err); }
  }

  // ---------------------------------------------------------------------------------------------------- exports

  async exportPdf(req, res, next) {
    try {
      sendFile(res, await requisicionExportService.requisicionPdf(req.tenantId, req.params.id, detailActor(req), caps(req)));
    } catch (err) { next(err); }
  }

  async exportXlsx(req, res, next) {
    try {
      sendFile(res, await requisicionExportService.requisicionXlsx(req.tenantId, req.params.id, detailActor(req), caps(req)));
    } catch (err) { next(err); }
  }

  async exportComparativo(req, res, next) {
    try {
      sendFile(res, await requisicionExportService.comparativo(req.tenantId, req.params.id, req.query.formato, caps(req)));
    } catch (err) { next(err); }
  }

  async exportListado(req, res, next) {
    try {
      const access = {
        canRead: userCanReadRequisiciones(req.user),
        canReceive: canReceive(req),
        canManageAll: canManageAll(req),
        canApprovePo: hasPerm(req, PERMISSIONS.REQUISICIONES_APPROVE_PO),
        canReports: true, // the route already requires requisiciones:reports
      };
      sendFile(res, await requisicionExportService.listadoXlsx(req.tenantId, req.user.userId, req.query, access, req.user, caps(req)));
    } catch (err) { next(err); }
  }
}

export const requisicionReporteController = new RequisicionReporteController();
