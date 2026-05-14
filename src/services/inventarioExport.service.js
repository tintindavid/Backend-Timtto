'use strict';

import ExcelJS from 'exceljs';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import PDFMicroserviceClient from './pdfMicroserviceClient.js';

const COLUMNS = [
  { key: 'item',       header: 'Ítem',                   width: 10 },
  { key: 'Marca',      header: 'Marca',                  width: 18 },
  { key: 'Modelo',     header: 'Modelo',                 width: 18 },
  { key: 'Serie',      header: 'Serie',                  width: 18 },
  { key: 'Inventario', header: 'Inventario',             width: 16 },
  { key: 'Ubicacion',  header: 'Ubicación',              width: 20 },
  { key: 'Riesgo',     header: 'Clasificación Riesgo',   width: 22 },
  { key: 'Invima',     header: 'Reg. INVIMA',            width: 18 },
  { key: 'Estado',     header: 'Estado',                 width: 14 },
];

export class InventarioExportService {
  constructor() {
    this.pdfClient = new PDFMicroserviceClient();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async #fetchData(clienteId, tenantId) {
    const filter = applyTenantFilter(
      { ClienteId: clienteId, isDeleted: false },
      tenantId
    );

    const equipos = await EquipoItem.find(filter)
      .populate('Servicio', 'nombre')
      .sort({ item: 1 })
      .lean();

    const tenant = await Tenant.findOne({ tenantId, isDeleted: false }).lean();

    return { equipos, tenant };
  }

  #groupByServicio(equipos) {
    const groups = new Map();
    const sinServicio = [];

    for (const equipo of equipos) {
      const nombre = equipo.Servicio?.nombre;
      if (!nombre) {
        sinServicio.push(equipo);
      } else {
        if (!groups.has(nombre)) groups.set(nombre, []);
        groups.get(nombre).push(equipo);
      }
    }

    // Sort named groups alphabetically (es locale)
    const sorted = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([servicioNombre, items]) => ({ servicioNombre, equipos: items }));

    // 'Sin Servicio' always last
    if (sinServicio.length > 0) {
      sorted.push({ servicioNombre: 'Sin Servicio', equipos: sinServicio });
    }

    return sorted;
  }

  // ---------------------------------------------------------------------------
  // Excel generation
  // ---------------------------------------------------------------------------

  async generateExcel(clienteId, tenantId) {
    const { equipos, tenant } = await this.#fetchData(clienteId, tenantId);

    if (!equipos.length) {
      throw new ApiError(404, 'El cliente no tiene equipos activos', 'NO_EQUIPOS');
    }

    const groups = this.#groupByServicio(equipos);
    const colCount = COLUMNS.length;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = tenant?.name || 'Timtto';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Inventario');

    // Define column widths and wrap style
    ws.columns = COLUMNS.map(col => ({
      key: col.key,
      width: col.width,
      style: { alignment: { wrapText: true, vertical: 'top' } },
    }));

    // --- Row 1: institutional header (merged, tenant name) ---
    ws.mergeCells(1, 1, 2, colCount);
    const titleCell = ws.getCell('A1');
    titleCell.value = tenant?.name || 'Inventario de Equipos';
    titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003366' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 32;
    ws.getRow(2).height = 20;

    // --- Attempt to embed logo ---
    if (tenant?.logoUrl) {
      try {
        const response = await fetch(tenant.logoUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer      = Buffer.from(arrayBuffer);
          const contentType = response.headers.get('content-type') || '';
          let ext = 'png';
          if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpeg';
          else if (contentType.includes('gif')) ext = 'gif';

          const imageId = workbook.addImage({ buffer, extension: ext });
          ws.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 1.5, row: 2 } });
        }
      } catch (err) {
        logger.warn('inventarioExport.generateExcel: logo del tenant no disponible', { err: err.message });
      }
    }

    // --- Row 3: column headers ---
    const headerRow = ws.getRow(3);
    COLUMNS.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF005B9A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });
    headerRow.height = 22;
    headerRow.commit();

    // Freeze rows 1-3
    ws.views = [{ state: 'frozen', ySplit: 3 }];

    // --- Data rows ---
    for (const group of groups) {
      // Service group header row
      const nextRowNum = ws.rowCount + 1;
      ws.mergeCells(nextRowNum, 1, nextRowNum, colCount);
      const serviceCell   = ws.getCell(nextRowNum, 1);
      serviceCell.value   = group.servicioNombre;
      serviceCell.font    = { bold: true, color: { argb: 'FF333333' } };
      serviceCell.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      serviceCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.getRow(nextRowNum).height = 18;
      ws.getRow(nextRowNum).commit();

      // Equipment rows
      for (const equipo of group.equipos) {
        const row = ws.addRow({
          item:       equipo.item       || '',
          Marca:      equipo.Marca      || '',
          Modelo:     equipo.Modelo     || '',
          Serie:      equipo.Serie      || '',
          Inventario: equipo.Inventario || '',
          Ubicacion:  equipo.Ubicacion  || '',
          Riesgo:     equipo.Riesgo     || '',
          Invima:     equipo.Invima     || '',
          Estado:     equipo.Estado     || '',
        });
        row.eachCell(cell => {
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
        });
        row.commit();
      }

      // Blank separator row between groups
      ws.addRow([]).commit();
    }

    logger.info(`inventarioExport.generateExcel: ${equipos.length} equipos, ${groups.length} grupos para clienteId=${clienteId}`);
    return workbook.xlsx.writeBuffer();
  }

  // ---------------------------------------------------------------------------
  // PDF generation (via HTML microservice)
  // ---------------------------------------------------------------------------

  async generatePDF(clienteId, tenantId) {
    const healthy = await this.pdfClient.healthCheck();
    if (!healthy) {
      throw new ApiError(503, 'Microservicio PDF no disponible', 'PDF_MICROSERVICE_OFFLINE');
    }

    const { equipos, tenant } = await this.#fetchData(clienteId, tenantId);

    if (!equipos.length) {
      throw new ApiError(404, 'El cliente no tiene equipos activos', 'NO_EQUIPOS');
    }

    const groups = this.#groupByServicio(equipos);
    const html   = this.#buildPDFHtml(groups, tenant);

    const pdfOptions = {
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '15mm', right: '8mm', bottom: '20mm', left: '8mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: this.#buildFooterTemplate(tenant),
    };

    const buffer = await this.pdfClient.generatePDF(html, pdfOptions);
    logger.info(`inventarioExport.generatePDF: PDF generado para clienteId=${clienteId}`);
    return buffer;
  }

  #buildFooterTemplate(tenant) {
    const ciudad = tenant?.ciudad || '';
    const email  = tenant?.email  || '';
    const fecha  = new Date().toLocaleDateString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });

    return `
      <div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#555;
                  padding:2mm 10mm;box-sizing:border-box;border-top:1px solid #ccc;
                  display:flex;justify-content:space-between;align-items:center;">
        <span>${ciudad}${email ? ' | ' + email : ''}</span>
        <span>Generado: ${fecha}</span>
        <span>Página <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`;
  }

  #buildPDFHtml(groups, tenant) {
    const tenantName = tenant?.name || 'Inventario de Equipos';

    // Sanitize tenant name and logo to avoid XSS in generated HTML
    const safeName = tenantName.replace(/[<>"'&]/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;' }[c]));
    const safeLogoUrl = tenant?.logoUrl
      ? tenant.logoUrl.replace(/[<>"']/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
      : null;

    const logoHtml = safeLogoUrl
      ? `<img src="${safeLogoUrl}" alt="Logo" style="height:48px;object-fit:contain;" onerror="this.style.display='none'" />`
      : '';

    const groupsHtml = groups.map(group => {
      const safeSvc = group.servicioNombre.replace(/[<>"'&]/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;' }[c]));
      const rows = group.equipos.map(e => {
        const esc = v => String(v || '').replace(/[<>"'&]/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;' }[c]));
        return `<tr>
          <td>${esc(e.item)}</td><td>${esc(e.Marca)}</td><td>${esc(e.Modelo)}</td>
          <td>${esc(e.Serie)}</td><td>${esc(e.Inventario)}</td><td>${esc(e.Ubicacion)}</td>
          <td>${esc(e.Riesgo)}</td><td>${esc(e.Invima)}</td><td>${esc(e.Estado)}</td>
        </tr>`;
      }).join('');

      return `
        <tr class="svc-hdr"><td colspan="9">${safeSvc}</td></tr>
        ${rows}
        <tr class="spacer"><td colspan="9"></td></tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9px; color: #222; }
  .page-header {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 0 6px; border-bottom: 2px solid #003366; margin-bottom: 10px;
  }
  .page-header h1 { font-size: 13px; color: #003366; flex: 1; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th {
    background: #005B9A; color: #fff; font-weight: bold;
    padding: 4px 5px; text-align: left; font-size: 8px;
    border-bottom: 2px solid #003366;
  }
  td { padding: 3px 5px; border-bottom: 1px solid #e8e8e8; vertical-align: top; word-break: break-word; }
  tr:nth-child(even) td { background: #f7f9fb; }
  .svc-hdr td { background: #d9d9d9; font-weight: bold; font-size: 9px; padding: 4px 8px; color: #333; }
  .spacer td  { height: 8px; background: transparent !important; }
  col.c-item   { width: 7%;  }
  col.c-marca  { width: 10%; }
  col.c-modelo { width: 10%; }
  col.c-serie  { width: 10%; }
  col.c-inv    { width: 10%; }
  col.c-ubic   { width: 15%; }
  col.c-riesgo { width: 14%; }
  col.c-invima { width: 12%; }
  col.c-estado { width: 12%; }
</style>
</head>
<body>
  <div class="page-header">
    ${logoHtml}
    <h1>${safeName} — Inventario de Equipos</h1>
  </div>
  <table>
    <colgroup>
      <col class="c-item"/><col class="c-marca"/><col class="c-modelo"/><col class="c-serie"/>
      <col class="c-inv"/><col class="c-ubic"/><col class="c-riesgo"/><col class="c-invima"/><col class="c-estado"/>
    </colgroup>
    <thead>
      <tr>
        <th>Ítem</th><th>Marca</th><th>Modelo</th><th>Serie</th>
        <th>Inventario</th><th>Ubicación</th><th>Clasificación Riesgo</th>
        <th>Reg. INVIMA</th><th>Estado</th>
      </tr>
    </thead>
    <tbody>
      ${groupsHtml}
    </tbody>
  </table>
</body>
</html>`;
  }
}

export const inventarioExportService = new InventarioExportService();
