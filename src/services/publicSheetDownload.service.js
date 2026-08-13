'use strict';
import mongoose from 'mongoose';
import { SheetWork } from '../models/sheetwork.model.js';
import { Tenant } from '../models/tenant.model.js';
import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { sheetWorkDownloadTokenService } from './sheetWorkDownloadToken.service.js';
import SheetWorkPDFService from './sheetworkPDF.service.js';
import BulkPDFGenerator from './bulkPDFGenerator.js';
import { getHTMLTemplate, generateHTMLFromReport } from '../utils/htmlTemplateGenerator.js';

/**
 * Serves the public HT + reports downloads gated by SheetWorkDownloadToken.
 * The middleware resolveSheetDownloadToken has already validated the token
 * and attached it to req.downloadToken.
 */
export class PublicSheetDownloadService {
  constructor() {
    this.pdfService = new SheetWorkPDFService();
  }

  async getMeta(tokenDoc) {
    const [sheet, tenant, ot] = await Promise.all([
      SheetWork.findOne(applyTenantFilter({ _id: tokenDoc.sheetId, isDeleted: false }, tokenDoc.tenantId))
        .select('numeroHoja estado')
        .lean(),
      Tenant.findOne({ tenantId: tokenDoc.tenantId }).select('name').lean(),
      OT.findById(tokenDoc.otId).select('Consecutivo').lean(),
    ]);
    if (!sheet) throw new ApiError(404, 'Hoja no encontrada', 'SHEET_NOT_FOUND');

    return {
      status: tokenDoc.status,
      sheetNumero: sheet.numeroHoja || null,
      otConsecutivo: ot?.Consecutivo || null,
      tenantName: tenant?.name || null,
      expiresAt: tokenDoc.expiresAt,
      downloadsAllowed: tokenDoc.downloadsAllowed,
      downloadsUsed: tokenDoc.downloadsUsed,
      allowReports: tokenDoc.allowReports,
      reportDownloadsAllowed: tokenDoc.reportDownloadsAllowed,
      reportDownloadsUsed: tokenDoc.reportDownloadsUsed,
    };
  }

  /**
   * Streams the HT PDF. Increments `downloadsUsed` atomically BEFORE
   * generating the PDF (so a stalled Puppeteer render doesn't let two
   * clients each get the last download). If PDF generation fails, we log
   * but do NOT decrement — the alternative (losing the count on retry) is
   * worse than the client losing a download slot on a rare rendering
   * failure they'd hit again on retry anyway.
   */
  async streamHtPdf(tokenDoc) {
    const inc = await sheetWorkDownloadTokenService.incrementHtDownload(tokenDoc._id);
    if (!inc.ok) throw new ApiError(410, 'Sin descargas disponibles', 'DOWNLOAD_EXHAUSTED');

    const pdfBuffer = await this.pdfService.generatePDF(String(tokenDoc.sheetId), tokenDoc.tenantId);
    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: tokenDoc.sheetId }, tokenDoc.tenantId))
      .select('numeroHoja')
      .lean();
    const filename = `HT-${sheet?.numeroHoja || String(tokenDoc.sheetId)}.pdf`;
    return { pdfBuffer, filename };
  }

  async streamReportsZip(tokenDoc) {
    if (!tokenDoc.allowReports) {
      throw new ApiError(403, 'Los reportes no están habilitados para este enlace', 'REPORTS_NOT_ALLOWED');
    }
    const inc = await sheetWorkDownloadTokenService.incrementReportDownload(tokenDoc._id);
    if (!inc.ok) throw new ApiError(410, 'Sin descargas de reportes disponibles', 'REPORTS_DOWNLOAD_EXHAUSTED');

    const tenantId = tokenDoc.tenantId;
    const sheetId = tokenDoc.sheetId;

    const reports = await Report.find({ hojaDeTrabajo: sheetId, tenantId, isDeleted: false })
      .populate('ClienteId')
      .populate({ path: 'Equipo', populate: { path: 'SedeId' } })
      .populate('ResponsableMtto', 'fullName role')
      .populate('orden', 'Consecutivo TipoServicio')
      .populate(
        'hojaDeTrabajo',
        'personaRecibe cargoRecibe firmaResponsableFile firmaFile numeroHoja cargoResponsable fullNameResponsable'
      )
      .lean();

    if (!reports.length) {
      throw new ApiError(404, 'No hay reportes asociados a esta hoja', 'REPORTS_NOT_FOUND');
    }

    const reportsWithRepuestos = await Promise.all(
      reports.map(async (r) => {
        const repuestos = await Repuestos.find({
          tenantId,
          $or: [{ ReporteSolicitudId: r._id }, { ReporteInstalacionId: r._id }],
        }).lean();
        return { ...r, repuestos };
      })
    );

    const tenantData = await Tenant.findOne({ tenantId, isDeleted: false }).lean();
    const generator = new BulkPDFGenerator();
    const template = getHTMLTemplate();
    const zipBuffer = await generator.generateBulkPDFs(reportsWithRepuestos, (report) =>
      generateHTMLFromReport(report, tenantData || {}, template)
    );

    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId }, tenantId))
      .select('numeroHoja')
      .lean();
    const iso = new Date().toISOString().split('T')[0];
    const filename = `reportes_${sheet?.numeroHoja || sheetId}_${iso}.zip`;
    return { zipBuffer, filename };
  }
}

export const publicSheetDownloadService = new PublicSheetDownloadService();
