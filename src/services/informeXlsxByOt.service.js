import ExcelJS from 'exceljs';
import { safeRow } from '../utils/excelSafe.util.js';

/**
 * Flat Excel of the equipment listed in an informe por OT (change: informe-por-ot-fotos-observaciones-excel).
 * One row per reporte across every Sede/Servicio section; no merged cells; every text cell goes through
 * `safeCell` (formula-injection prefix). Photos and observations are intentionally ignored.
 */

export const INFORME_OT_XLSX_HEADERS = [
  'Reporte', 'OT', 'Equipo', 'Marca', 'Modelo', 'Serie', 'Inventario', 'Ubicación',
  'Sede', 'Servicio', 'Estado operativo', 'Estado del reporte', 'Fecha realizado', 'Técnico',
];

export async function buildInformePorOtXlsx(payload) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TIMTTO';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Equipos');
  sheet.addRow(INFORME_OT_XLSX_HEADERS);
  sheet.getRow(1).font = { bold: true };

  for (const sec of payload.secciones || []) {
    for (const r of sec.reportes || []) {
      sheet.addRow(safeRow([
        r.consecutivo, r.otConsecutivo, r.equipoNombre, r.marca, r.modelo, r.serie, r.inventario,
        r.ubicacion, r.sede || sec.sede, r.servicio || sec.servicio, r.estadoOperativo, r.estadoReporte,
        r.fechaRealizado, r.tecnico,
      ]));
    }
  }

  INFORME_OT_XLSX_HEADERS.forEach((h, i) => { sheet.getColumn(i + 1).width = Math.max(14, h.length + 4); });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: INFORME_OT_XLSX_HEADERS.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
