import { reportService } from '../services/report.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ReportController {
  async create(req, res, next) {
    try {
      const data = await reportService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Report creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await reportService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Reports recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async listByOt(req, res, next) {
    try {
      const { otId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const result = await reportService.listByOt(otId, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Reports por OT recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  /**
   * Lista reports filtrados por Equipo
   * Ruta: GET /api/v1/report/equipo/:equipoId
   */
  async listByEquipo(req, res, next) {
    try {
      const { equipoId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const result = await reportService.listByEquipo(equipoId, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Reports por Equipo recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await reportService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Report recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async procesar(req, res, next) {
    try {
      const reporteId = req.params.reporteId;
      const payload = req.body;
      console.log('Payload procesar report:', payload);
      const result = await reportService.procesar(reporteId, payload, req.tenantId, req.user);
      res.json(successResponse(result, 'Report procesado y OT notificada exitosamente'));
    } catch (err) { next(err); }
  }

  async unprocess(req, res, next) {
    try {
      const reporteId = req.params.reporteId;
      const result = await reportService.unprocess(reporteId, req.tenantId, req.user);
      res.json(successResponse(result, 'Procesamiento anulado'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await reportService.update(req.params.id, req.body, req.tenantId, req.user);
      res.json(successResponse(data, 'Report actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await reportService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Report eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  async uploadEvidencias(req, res, next) {
    try {
      const { reporteId } = req.params;
      const userId = req.user?.userId;
      const files = req.files || [];
      // Multer parses non-file multipart fields into req.body. Multiple values
      // for the same field name arrive as an array; a single value as a string.
      const rawDescs = req.body?.descripciones;
      const descripciones = Array.isArray(rawDescs)
        ? rawDescs
        : rawDescs !== undefined && rawDescs !== null
          ? [rawDescs]
          : [];
      const evidencias = await reportService.addEvidencias(
        reporteId,
        req.tenantId,
        files,
        userId,
        descripciones
      );
      res.status(201).json(successResponse({ evidencias }, 'Evidences uploaded successfully', 201));
    } catch (err) { next(err); }
  }

  async deleteEvidencia(req, res, next) {
    try {
      const { reporteId, evidenciaId } = req.params;
      const evidencias = await reportService.removeEvidencia(reporteId, req.tenantId, evidenciaId);
      res.json(successResponse({ evidencias }, 'Evidence deleted successfully'));
    } catch (err) { next(err); }
  }

  async updateEvidencia(req, res, next) {
    try {
      const { reporteId, evidenciaId } = req.params;
      const { descripcion } = req.body || {};
      const evidencias = await reportService.updateEvidenciaDescripcion(
        reporteId,
        req.tenantId,
        evidenciaId,
        descripcion
      );
      res.json(successResponse({ evidencias }, 'Evidence updated successfully'));
    } catch (err) { next(err); }
  }

  async updateVerificationParams(req, res, next) {
    try {
      const { reporteId } = req.params;
      const { verificationParam } = req.body || {};
      const report = await reportService.updateVerificationParams(
        reporteId,
        req.tenantId,
        verificationParam
      );
      res.json(successResponse(report, 'Verification parameters updated successfully'));
    } catch (err) { next(err); }
  }

  async suggestVerificationParams(req, res, next) {
    try {
      const { equipoId, excludeReporteId } = req.query;
      const data = await reportService.suggestVerificationParams(equipoId, req.tenantId, { excludeReporteId });
      res.json(successResponse(data, 'Sugerencia de parámetros'));
    } catch (err) { next(err); }
  }

  async historyVerificationParams(req, res, next) {
    try {
      const { equipoId } = req.query;
      const data = await reportService.historyVerificationParams(equipoId, req.tenantId);
      res.json(successResponse(data, 'Historial de parámetros'));
    } catch (err) { next(err); }
  }

  /**
   * Batch-append extra activities from the ActividadMtto catalog to a report
   * (report-actividades-extra). The service enforces all invariants including
   * "don't mutate the item's protocol".
   */
  async addExtraActividades(req, res, next) {
    try {
      const { reporteId } = req.params;
      const { actividadMttoIds } = req.body || {};
      const data = await reportService.addExtraActividades(
        reporteId,
        actividadMttoIds,
        req.tenantId,
        req.user
      );
      res.status(201).json(successResponse(data, 'Actividades extra agregadas exitosamente', 201));
    } catch (err) { next(err); }
  }

  /**
   * Remove a single extra actividad from a report. Refuses to touch
   * protocol-originated entries.
   */
  async removeExtraActividad(req, res, next) {
    try {
      const { reporteId, actividadRealizadaId } = req.params;
      const data = await reportService.removeExtraActividad(
        reporteId,
        actividadRealizadaId,
        req.tenantId,
        req.user
      );
      res.json(successResponse(data, 'Actividad extra removida exitosamente'));
    } catch (err) { next(err); }
  }
}

export const reportController = new ReportController();

