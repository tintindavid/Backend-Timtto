'use strict';
import { publicSheetDownloadService } from '../services/publicSheetDownload.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class PublicSheetDownloadController {
  async get(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const data = await publicSheetDownloadService.getMeta(req.downloadToken);
      res.status(200).json(successResponse(data, 'Estado del enlace de descarga'));
    } catch (err) { next(err); }
  }

  async downloadPdf(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const { pdfBuffer, filename } = await publicSheetDownloadService.streamHtPdf(req.downloadToken);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length,
      });
      res.send(pdfBuffer);
    } catch (err) { next(err); }
  }

  async downloadReportsZip(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const { zipBuffer, filename } = await publicSheetDownloadService.streamReportsZip(req.downloadToken);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length,
      });
      res.send(zipBuffer);
    } catch (err) { next(err); }
  }
}

export const publicSheetDownloadController = new PublicSheetDownloadController();
