'use strict';
import BulkPDFGenerator from '../services/bulkPDFGenerator.js';
import PDFMicroserviceClient from '../services/pdfMicroserviceClient.js';
import { getHTMLTemplate, generateHTMLFromReport } from '../utils/htmlTemplateGenerator.js';
import { Report } from '../models/report.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { logger } from '../config/logger.config.js';
import { successResponse, errorResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import {Tenant} from '../models/tenant.model.js' //importar service de tenant 

export async function generateBulkPDFs(req, res, next) {
  try {
    const tenantId = req.tenantId;

    const { reportIds, filters = {}, otId, sheetworkId, fileNameConfig } = req.body; // parámetros opcionales
    let query = {};  

    if (reportIds && Array.isArray(reportIds) && reportIds.length) {  // cuando se proporcionan reportIds específicos  
      query = { _id: { $in: reportIds } };
    } else if (otId) {
      // When generating from an OT only include Closed or Cancelled
      query = { orden: otId, estado: { $in: ['Cerrado', 'Cancelado'] } };
    } else if (sheetworkId) {
      query = { hojaDeTrabajo: sheetworkId };
    } else if (filters && Object.keys(filters).length) {
      query = { ...filters };
    } else {
      return res.status(400).json(errorResponse('Debes proporcionar reportIds, otId, sheetworkId o filters', 'INVALID_PARAMS'));
    }

    query = applyTenantFilter({ ...query, isDeleted: false }, tenantId);

    
    const tenantData = await Tenant.findOne({ tenantId: tenantId, isDeleted: false }).lean();
    logger.info('tenantid consultado: ')
    logger.info(tenantId)
    if (!tenantData) {
      return res.status(404).json(errorResponse('Tenant no encontrado', 'TENANT_NOT_FOUND'));
    }

    const reports = await Report.find(query).lean()
    .populate('ClienteId')
    .populate({ path: 'Equipo', populate: { path: 'SedeId' } }) // popular la sede del equipo Equipo.SedeId
    .populate('ResponsableMtto', 'fullName role')
    .populate('orden', 'Consecutivo TipoServicio')
    .populate('hojaDeTrabajo', 'personaRecibe cargoRecibe firmaResponsableFile firmaFile numeroHoja cargoResponsable fullNameResponsable ');
    if (!reports || !reports.length) return res.status(404).json(errorResponse('No se encontraron reportes', 'NOT_FOUND'));

    // attach repuestos to each report
    const reportsWithRepuestos = await Promise.all(reports.map(async (r) => {
      const repuestos = await Repuestos.find({ $or: [{ ReporteSolicitudId: r._id }, { ReporteInstalacionId: r._id }] }).lean();
      return { ...r, repuestos };
    }));

    const generator = new BulkPDFGenerator();
    const template = getHTMLTemplate();
    const zipBuffer = await generator.generateBulkPDFs(
      reportsWithRepuestos,
      (report) => generateHTMLFromReport(report, tenantData, template),
      { fileNameConfig }
    );

    const iso = new Date().toISOString().split('T')[0];
    const fileName = `reportes_${iso}_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    return res.send(zipBuffer);
  } catch (err) { next(err); }
}

export async function generateSinglePDF(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const reportId = req.body.reportId || req.params.reportId;
    if (!reportId) return res.status(400).json(errorResponse('reportId es requerido', 'INVALID_PARAMS'));

    const report = await Report.findOne(applyTenantFilter({ _id: reportId }, tenantId)).lean();
    if (!report) return res.status(404).json(errorResponse('Reporte no encontrado', 'NOT_FOUND'));

    const repuestos = await Repuestos.find({ $or: [{ ReporteSolicitudId: report._id }, { ReporteInstalacionId: report._id }] }).lean();
    const fullReport = { ...report, repuestos };

    const client = new PDFMicroserviceClient();
    const template = getHTMLTemplate();
    const html = generateHTMLFromReport(fullReport, template);
    const pdfBuffer = await client.generatePDF(html);

    const fileName = `${report.consecutivo || report._id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) { next(err); }
}

export async function downloadReportPDF(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const tenantData = await Tenant.findOne({ tenantId, isDeleted: false }).lean();
    if (!tenantData) return res.status(404).json(errorResponse('Tenant no encontrado', 'TENANT_NOT_FOUND'));

    const report = await Report.findOne(applyTenantFilter({ _id: id, isDeleted: false }, tenantId))
      .populate('ClienteId')
      .populate({ path: 'Equipo', populate: { path: 'SedeId' } })
      .populate('orden', 'Consecutivo TipoServicio')
      .populate('hojaDeTrabajo', 'personaRecibe cargoRecibe firmaResponsableFile firmaFile cargoResponsable fullNameResponsable')
      .lean();
    if (!report) return res.status(404).json(errorResponse('Reporte no encontrado', 'NOT_FOUND'));

    const repuestos = await Repuestos.find({ $or: [{ ReporteSolicitudId: report._id }, { ReporteInstalacionId: report._id }] }).lean();
    const fullReport = { ...report, repuestos };

    const html = generateHTMLFromReport(fullReport, tenantData, getHTMLTemplate());
    const pdfBuffer = await new PDFMicroserviceClient().generatePDF(html);

    const consecutivo = report.consecutivo || '';
    const itemText = report.equipoSnapshot?.ItemText || '';
    const fileName = encodeURIComponent(`${consecutivo} ${itemText}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fileName}`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) { next(err); }
}

export async function checkMicroserviceHealth(_req, res, next) {
  try {
    const client = new PDFMicroserviceClient();
    const ok = await client.healthCheck();
    return res.json(successResponse({ status: ok ? 'online' : 'offline', url: process.env.PDF_SERVICE_URL || '' }, 'Microservicio PDF'));
  } catch (err) { next(err); }
}
