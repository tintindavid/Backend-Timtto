'use strict';
import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { EquipmentQr } from '../models/equipmentQr.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { readQrPngDataUri, generateQrPng } from '../utils/qrImage.util.js';
import { env } from '../config/env.js';
import { MAX_BULK_PDF, BULK_PDF_STICKERS_PER_PAGE } from '../constants/equipmentQr.constants.js';

const QR_IMAGE_SCOPE = 'equipment-qrs';

/**
 * Sticker labels — lines 1 and 2 are fixed copy; line 3 is the equipo's
 * `Inventario` (dynamic per sticker) so the printed label matches the asset
 * tag glued to the physical equipment.
 */
const STICKER_FIXED_LINES = ['Mantenimiento', 'Información'];

/**
 * equipmentQrPdf.service — reuses the existing PDF microservice client
 * (pdfMicroserviceClient.js, same engine as pdfReports.controller.js) to
 * render HTML/CSS sticker layouts into PDF buffers. No new dependency.
 */
async function resolveDataUri(doc) {
  const existing = await readQrPngDataUri(doc._id.toString(), QR_IMAGE_SCOPE);
  if (existing) return existing;
  // Fallback: regenerate on the fly if the persisted PNG is missing.
  const landingUrl = `${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/public/equipo/${doc.qrToken}`;
  const buffer = await generateQrPng(landingUrl);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function stickerHtml(dataUri, inventario) {
  const lines = [...STICKER_FIXED_LINES, inventario || '—'];
  return `
    <div class="sticker">
      <img class="qr" src="${dataUri}" alt="QR" />
      <div class="labels">
        ${lines.map((l) => `<div class="label">${escapeHtml(l)}</div>`).join('')}
      </div>
    </div>`;
}

function bulkHtml(pagesHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Inter', Arial, sans-serif; margin: 0; }
    .page { display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(5, 1fr); gap: 4mm; page-break-after: always; height: 277mm; }
    .page:last-child { page-break-after: auto; }
    .sticker { width: 80mm; height: 40mm; display: flex; align-items: center; gap: 4mm; border: 0.2mm dashed #D1D5DB; padding: 2mm; }
    .qr { width: 35mm; height: 35mm; object-fit: contain; flex: 0 0 auto; }
    .labels { display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
    .label { font-size: 11pt; font-weight: 700; color: #1F2937; line-height: 1.1; }
  </style></head><body>${pagesHtml}</body></html>`;
}

function singleHtml(dataUri, inventario) {
  const lines = [...STICKER_FIXED_LINES, inventario || '—'];
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    @page { size: A6 landscape; margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Inter', Arial, sans-serif; margin: 0; display: flex; align-items: center; justify-content: center; height: 100%; }
    .sticker { display: flex; align-items: center; gap: 5mm; width: 100%; }
    .qr { width: 55mm; height: 55mm; object-fit: contain; flex: 0 0 auto; }
    .labels { display: flex; flex-direction: column; justify-content: center; gap: 2mm; }
    .label { font-size: 14pt; font-weight: 700; color: #1F2937; line-height: 1.15; }
  </style></head><body>
    <div class="sticker">
      <img class="qr" src="${dataUri}" alt="QR" />
      <div class="labels">
        ${lines.map((l) => `<div class="label">${escapeHtml(l)}</div>`).join('')}
      </div>
    </div>
  </body></html>`;
}

export class EquipmentQrPdfService {
  /** GET /equipment-qrs/export-pdf/:id — single A6-landscape sticker. */
  async generateSingle(id, tenantId) {
    requireTenant(tenantId);
    const doc = await EquipmentQr.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!doc) throw new ApiError(404, 'QR de equipo no encontrado', 'NOT_FOUND', { id });

    const equipo = await EquipoItem.findOne(applyTenantFilter({ _id: doc.equipoId }, tenantId))
      .select('Inventario')
      .lean();

    const dataUri = await resolveDataUri(doc);
    const html = singleHtml(dataUri, equipo?.Inventario);
    const client = new PDFMicroserviceClient();
    return client.generatePDF(html, {
      format: 'A6',
      landscape: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
  }

  /**
   * GET /equipment-qrs/export-pdf?ids=… — bulk A4-landscape, 10 stickers/page.
   * `ids` MUST already be resolved + tenant-filtered by the caller
   * (equipmentQrService.resolveIdsForExport / explicit list) and capped at
   * MAX_BULK_PDF before calling this (design D12) — this method re-checks
   * the cap defensively.
   */
  async generateBulk(ids, tenantId) {
    requireTenant(tenantId);
    if (!Array.isArray(ids) || !ids.length) {
      throw new ApiError(404, 'No se encontraron QRs para exportar', 'NOT_FOUND');
    }
    if (ids.length > MAX_BULK_PDF) {
      throw new ApiError(
        400,
        `El PDF admite máximo ${MAX_BULK_PDF} stickers; filtra la selección`,
        'BULK_PDF_LIMIT_EXCEEDED',
        { count: ids.length, max: MAX_BULK_PDF }
      );
    }

    const docs = await EquipmentQr.find(applyTenantFilter({ _id: { $in: ids } }, tenantId)).lean();
    if (!docs.length) throw new ApiError(404, 'No se encontraron QRs para exportar', 'NOT_FOUND');

    const equipos = await EquipoItem.find(
      applyTenantFilter({ _id: { $in: docs.map((d) => d.equipoId) } }, tenantId)
    )
      .select('_id Inventario')
      .lean();
    const inventarioByEquipoId = new Map(equipos.map((e) => [String(e._id), e.Inventario]));

    const dataUris = await Promise.all(docs.map(resolveDataUri));
    const stickers = docs.map((d, i) => stickerHtml(dataUris[i], inventarioByEquipoId.get(String(d.equipoId))));
    const pages = [];
    for (let i = 0; i < stickers.length; i += BULK_PDF_STICKERS_PER_PAGE) {
      pages.push(`<div class="page">${stickers.slice(i, i + BULK_PDF_STICKERS_PER_PAGE).join('')}</div>`);
    }

    const html = bulkHtml(pages.join(''));
    const client = new PDFMicroserviceClient();
    return client.generatePDF(html, {
      format: 'A4',
      landscape: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  }
}

export const equipmentQrPdfService = new EquipmentQrPdfService();
