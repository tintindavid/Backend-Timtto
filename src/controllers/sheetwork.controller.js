import { sheetWorkService } from '../services/sheetwork.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import SheetWorkPDFService from '../services/sheetworkPDF.service.js';
import { logger } from '../config/logger.config.js';

const pdfService = new SheetWorkPDFService();

export class SheetWorkController {
  async create(req, res, next) {
    try {
      const data = await sheetWorkService.create(req.body, req.tenantId, req.user);

      res.status(201).json(successResponse(data, 'SheetWork creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await sheetWorkService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'SheetWorks recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await sheetWorkService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'SheetWork recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async listByOt(req, res, next) {
    try {
      const otId = req.params.otId;
      const result = await sheetWorkService.listByOt(otId, {}, req.tenantId);
      res.json(successResponse(result.data, 'SheetWorks por OT recuperados', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await sheetWorkService.update(req.params.id, req.body, req.tenantId, req.user);
      res.json(successResponse(data, 'SheetWork actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await sheetWorkService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'SheetWork eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * Admin retro-mitigation (sheet-report-closure spec): closes every
   * `Procesado` report linked to this sheet, recomputes the OT, and fires
   * the ticket cascade.
   * POST /api/v1/sheetworks/:sheetId/close-reports
   */
  async closeReports(req, res, next) {
    try {
      const data = await sheetWorkService.closeReports(req.params.sheetId, req.tenantId, req.user);
      res.status(200).json(successResponse(data, 'Reportes cerrados exitosamente'));
    } catch (err) { next(err); }
  }

  /** POST /api/v1/sheetwork/remote-sign-request */
  async remoteSignRequest(req, res, next) {
    try {
      const data = await sheetWorkService.remoteSignRequest(req.body, req.tenantId, req.user?.userId || req.user?.id);
      res.status(201).json(successResponse(data, 'Solicitud de firma enviada', 201));
    } catch (err) { next(err); }
  }

  /** POST /api/v1/sheetwork/:sheetId/resend-sign-request */
  async resendSignRequest(req, res, next) {
    try {
      const data = await sheetWorkService.resendSignRequest(
        req.params.sheetId,
        req.body,
        req.tenantId,
        req.user?.userId || req.user?.id
      );
      res.status(200).json(successResponse(data, 'Solicitud reenviada'));
    } catch (err) { next(err); }
  }

  /** POST /api/v1/sheetwork/:sheetId/share */
  async shareSignedSheet(req, res, next) {
    try {
      const data = await sheetWorkService.shareSignedSheet(
        req.params.sheetId,
        req.body,
        req.tenantId,
        req.user?.userId || req.user?.id
      );
      res.status(200).json(successResponse(data, 'Link de descarga enviado'));
    } catch (err) { next(err); }
  }

  /** POST /api/v1/sheetwork/:sheetId/sign-inplace */
  async signInPlace(req, res, next) {
    try {
      const data = await sheetWorkService.signInPlace(
        req.params.sheetId,
        req.body,
        req.tenantId,
        req.user?.userId || req.user?.id
      );
      res.status(200).json(successResponse(data, 'Hoja firmada en sitio'));
    } catch (err) { next(err); }
  }

  /**
   * Genera PDF de la hoja de trabajo
   * GET /api/v1/sheet-works/:id/pdf
   */
  async generatePDF(req, res, next) {
    try {
      const { id } = req.params;
      const tenantId = req.tenantId;

      logger.info('Solicitud de generación de PDF de Hoja de Trabajo', { id, tenantId });

      // Obtener datos del sheetwork para construir el nombre del archivo
      const sheetWork = await sheetWorkService.getById(id, tenantId);
      
      const pdfBuffer = await pdfService.generatePDF(id, tenantId);

      // Construir nombre del archivo: HT-{consecutivo}-{cliente}.pdf
      const consecutivo = sheetWork.numeroHoja || 'SN';
      const clienteNombre = sheetWork.clienteId?.Razonsocial || 'Cliente';
      
      // Sanitizar nombre del archivo (remover caracteres especiales)
      const sanitizedCliente = clienteNombre
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remover acentos
        .replace(/[^a-zA-Z0-9-_]/g, '-')  // Reemplazar caracteres especiales con guión
        .replace(/-+/g, '-')               // Eliminar guiones múltiples
        .substring(0, 50);                 // Limitar longitud
      
      const filename = `HT-${consecutivo}-${sanitizedCliente}.pdf`;

      // Configurar headers para descarga con nombre personalizado
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length,
      });

      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }
}

export const sheetWorkController = new SheetWorkController();
