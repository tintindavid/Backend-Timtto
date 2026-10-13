import { hVEquipoService } from '../services/hvequipo.service.js';
import { hvEquipoPDFService } from '../services/hvequipoPDF.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export class HVEquipoController {
  async create(req, res, next) {
    try {
      const data = await hVEquipoService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'HVEquipo creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await hVEquipoService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'HVEquipos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  /**
   * Lista HVEquipos aprobadas por Marca y Modelo
   * Ruta: GET /api/v1/hv-equipo/aprobadas/:marca/:modelo
   */
  async listApproved(req, res, next) {
    try {
      const { marca, modelo } = req.params;
      const { page, limit, sortBy, order } = req.query;
      
      const result = await hVEquipoService.listApprovedByMarcaModelo(
        marca, 
        modelo, 
        { page, limit, sortBy, order }, 
        req.tenantId
      );
      
      res.json(successResponse(
        result.data, 
        `HVEquipos aprobadas para ${marca} ${modelo} recuperadas exitosamente`,
        200,
        result.pagination
      ));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await hVEquipoService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'HVEquipo recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * Obtiene HVEquipo por EquipoId (más reciente)
   * Ruta: GET /api/v1/hv-equipo/equipo/:equipoId
   */
  async getByEquipoId(req, res, next) {
    try {
      const data = await hVEquipoService.getByEquipoId(req.params.equipoId, req.tenantId);
      res.json(successResponse(data, 'HVEquipo recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await hVEquipoService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'HVEquipo actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await hVEquipoService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'HVEquipo eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * Adds a document (link and/or file) to an HV
   * Ruta: POST /api/v1/hv-equipo/:id/documentos
   */
  async uploadDocumento(req, res, next) {
    try {
      const { nombre, link, categoria } = req.body;
      if (!req.file && !(link && String(link).trim())) {
        throw new ApiError(400, 'Debes indicar un link o adjuntar un archivo', 'INVALID_DOCUMENTO');
      }
      const data = await hVEquipoService.addDocumento(req.params.id, req.tenantId, { nombre, link, categoria, file: req.file });
      res.status(201).json(successResponse(data, 'Documento agregado exitosamente', 201));
    } catch (err) { next(err); }
  }

  /**
   * Updates a document of an HV
   * Ruta: PUT /api/v1/hv-equipo/:id/documentos/:docId
   */
  async updateDocumento(req, res, next) {
    try {
      const { nombre, link } = req.body;
      const data = await hVEquipoService.updateDocumento(req.params.id, req.tenantId, req.params.docId, { nombre, link, file: req.file });
      res.json(successResponse(data, 'Documento actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * Removes a document of an HV
   * Ruta: DELETE /api/v1/hv-equipo/:id/documentos/:docId
   */
  async deleteDocumento(req, res, next) {
    try {
      const data = await hVEquipoService.removeDocumento(req.params.id, req.tenantId, req.params.docId);
      res.json(successResponse(data, 'Documento eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * Genera y descarga PDF de la Hoja de Vida
   * Ruta: GET /api/v1/hv-equipo/:id/pdf
   */
  async downloadPDF(req, res, next) {
    try {
      logger.info(`📄 Generando PDF para HV: ${req.params.id}`);
      const { buffer, filename } = await hvEquipoPDFService.generatePDF(req.params.id, req.tenantId);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      
      res.send(buffer);
      logger.info(`✅ PDF descargado: ${filename}`);
    } catch (err) {
      logger.error('❌ Error generando PDF:', err);
      next(err);
    }
  }
}

export const hVEquipoController = new HVEquipoController();
