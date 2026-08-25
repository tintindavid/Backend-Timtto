'use strict';

/**
 * Excel counterpart of `downloadCronogramaPDF` (cronograma.controller.js)
 * — equipo-estado-operativo-editable-y-cronograma-excel,
 * cronograma-excel-por-filtros. Mirrors the PDF endpoint's query contract
 * (`{ clienteId, filtros }`) and hierarchy (Cliente → Servicio → Sede →
 * Equipo) so both formats always cover the same equipo set (design.md D8).
 *
 * The equipo query is intentionally duplicated from
 * `cronograma.controller.js#downloadCronogramaPDF` rather than extracted
 * into a shared helper, to keep the existing PDF endpoint fully untouched
 * (cronograma-pdf-por-filtros spec: "the backend PDF endpoint is
 * unchanged").
 */
import ExcelJS from 'exceljs';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Customer } from '../models/customer.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_HEADERS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const COLUMNS_BASE = ['Ítem', 'Marca', 'Modelo', 'Serie', 'Inventario', 'Ubicación'];
const COLUMN_ESTADO_OPERATIVO = 'Estado Operativo';
const HEADER_ROW = [...COLUMNS_BASE, ...MES_HEADERS, COLUMN_ESTADO_OPERATIVO];
const COL_COUNT = HEADER_ROW.length;
const COL_ESTADO_OPERATIVO_IDX = COLUMNS_BASE.length + MES_HEADERS.length + 1; // 1-indexed for ExcelJS

const FILL_CLIENTE = 'FF003366';
const FILL_SERVICIO = 'FF0066CC';
const FILL_SEDE = 'FFD9D9D9';
const FILL_HEADER = 'FF005B9A';
const FILL_REALIZADO = 'FF28A745';
const FILL_PROGRAMADO = 'FF4A90D9';

export class CronogramaExportService {
  async #fetchEquipos({ clienteId, filtros = {} }, tenantId) {
    const customer = await Customer.findOne({ _id: clienteId, tenantId, isDeleted: false }).lean();
    if (!customer) {
      throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND');
    }

    const { sedeIds, servicioIds, meses, ubicaciones, estado } = filtros;
    const query = {
      ClienteId: clienteId,
      tenantId,
      isDeleted: false,
      ...(sedeIds?.length && { SedeId: { $in: sedeIds } }),
      ...(servicioIds?.length && { Servicio: { $in: servicioIds } }),
      ...(meses?.length && { mesesMtto: { $in: meses } }),
      ...(ubicaciones?.length && { Ubicacion: { $in: ubicaciones } }),
      ...(estado && { Estado: estado }),
    };

    const equipos = await EquipoItem.find(query)
      .populate('ItemId', 'Nombre')
      .populate('SedeId', 'nombreSede')
      .populate('Servicio', 'nombre')
      .lean();

    return { customer, equipos };
  }

  #groupByServicioSede(equipos) {
    const servicios = new Map();
    for (const equipo of equipos) {
      const servicioNombre = equipo.Servicio?.nombre || 'Sin Servicio';
      const sedeNombre = equipo.SedeId?.nombreSede || 'Sin Sede';
      if (!servicios.has(servicioNombre)) servicios.set(servicioNombre, new Map());
      const sedes = servicios.get(servicioNombre);
      if (!sedes.has(sedeNombre)) sedes.set(sedeNombre, []);
      sedes.get(sedeNombre).push(equipo);
    }
    return [...servicios.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([servicioNombre, sedesMap]) => ({
        servicioNombre,
        sedes: [...sedesMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'es'))
          .map(([sedeNombre, items]) => ({ sedeNombre, equipos: items })),
      }));
  }

  /**
   * @param {{clienteId: string, filtros?: object}} params
   * @param {string} tenantId
   * @returns {Promise<{buffer: Buffer, customer: object, equipos: object[]}>}
   *   `customer`/`equipos` are returned alongside the buffer so the caller
   *   (cronograma.controller.js#downloadExcel) can build the
   *   `cronograma_<clienteName>_<date>.xlsx` filename without a second DB
   *   round-trip.
   */
  async generateExcel({ clienteId, filtros = {} }, tenantId) {
    const { customer, equipos } = await this.#fetchEquipos({ clienteId, filtros }, tenantId);

    // When the user narrowed the cronograma by month, marks in months
    // outside that filter would mismatch the visible schedule. Mask both
    // programado and realizado sets to the filtered months. Empty filter =
    // no mask (all 12 months rendered as before).
    const monthMask = filtros?.meses?.length
      ? new Set(filtros.meses.map((m) => (m || '').toLowerCase()))
      : null;

    if (!equipos.length) {
      throw new ApiError(404, 'No se encontraron equipos con los filtros especificados', 'NO_EQUIPOS');
    }

    const grupos = this.#groupByServicioSede(equipos);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Timtto';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Cronograma');

    ws.columns = HEADER_ROW.map((_, idx) => {
      if (idx < COLUMNS_BASE.length) return { width: 20 };
      if (idx === COL_ESTADO_OPERATIVO_IDX - 1) return { width: 22 };
      return { width: 5 };
    });

    // Row 1: Cliente header (merged across every column) — single clienteId
    // per request, so this is always exactly one row (design.md D8).
    ws.mergeCells(1, 1, 1, COL_COUNT);
    const clienteCell = ws.getCell(1, 1);
    clienteCell.value = customer.Razonsocial || 'Cliente';
    clienteCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    clienteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_CLIENTE } };
    clienteCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 24;

    // Row 2: equipo column headers (frozen + autofilter target).
    const headerRowNum = 2;
    const headerRow = ws.getRow(headerRowNum);
    HEADER_ROW.forEach((h, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.commit();

    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowNum }];
    ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: COL_COUNT } };

    for (const grupo of grupos) {
      const servicioRowNum = ws.rowCount + 1;
      ws.mergeCells(servicioRowNum, 1, servicioRowNum, COL_COUNT);
      const servicioCell = ws.getCell(servicioRowNum, 1);
      servicioCell.value = grupo.servicioNombre;
      servicioCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      servicioCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SERVICIO } };
      servicioCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.getRow(servicioRowNum).commit();

      for (const sede of grupo.sedes) {
        const sedeRowNum = ws.rowCount + 1;
        ws.mergeCells(sedeRowNum, 1, sedeRowNum, COL_COUNT);
        const sedeCell = ws.getCell(sedeRowNum, 1);
        sedeCell.value = sede.sedeNombre;
        sedeCell.font = { bold: true, color: { argb: 'FF333333' } };
        sedeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SEDE } };
        sedeCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 2 };
        ws.getRow(sedeRowNum).commit();

        for (const equipo of sede.equipos) {
          const rowNum = ws.rowCount + 1;
          const row = ws.getRow(rowNum);
          row.getCell(1).value = equipo.ItemId?.Nombre || equipo.item || '';
          row.getCell(2).value = equipo.Marca || '';
          row.getCell(3).value = equipo.Modelo || '';
          row.getCell(4).value = equipo.Serie || '';
          row.getCell(5).value = equipo.Inventario || '';
          row.getCell(6).value = equipo.Ubicacion || '';

          // realizado (green) wins over programado (blue) when both are true
          // for the same month (design.md 6.3 / task briefing). When the
          // user applied a month filter, marks outside that filter are
          // suppressed so the Excel matches the visible cronograma.
          const mesesRealizados = new Set(
            (equipo.mesesMttoRealizados || [])
              .map((m) => (m.mes || '').toLowerCase())
              .filter((m) => !monthMask || monthMask.has(m))
          );
          const mesesProgramados = new Set(
            (equipo.mesesMtto || [])
              .map((m) => (m || '').toLowerCase())
              .filter((m) => !monthMask || monthMask.has(m))
          );

          MESES.forEach((mes, idx) => {
            const cell = row.getCell(COLUMNS_BASE.length + idx + 1);
            if (mesesRealizados.has(mes)) {
              cell.value = '✓';
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_REALIZADO } };
              cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            } else if (mesesProgramados.has(mes)) {
              cell.value = '✓';
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_PROGRAMADO } };
              cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            }
            cell.alignment = { horizontal: 'center' };
          });

          // Estado Operativo — last column.
          const estadoCell = row.getCell(COL_ESTADO_OPERATIVO_IDX);
          estadoCell.value = equipo.EstadoOperativo || 'Operativo';
          estadoCell.alignment = { horizontal: 'center' };

          row.commit();
        }
      }
    }

    // Legend — appended two rows below the last data row so anyone opening
    // the workbook can decode the coloured marks without asking.
    ws.addRow([]);
    const legendTitleRowNum = ws.rowCount + 1;
    ws.mergeCells(legendTitleRowNum, 1, legendTitleRowNum, COL_COUNT);
    const legendTitle = ws.getCell(legendTitleRowNum, 1);
    legendTitle.value = 'Leyenda';
    legendTitle.font = { bold: true, color: { argb: 'FF333333' } };
    legendTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    const realizadoRowNum = ws.rowCount + 1;
    const realizadoRow = ws.getRow(realizadoRowNum);
    const realizadoMark = realizadoRow.getCell(1);
    realizadoMark.value = '✓';
    realizadoMark.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_REALIZADO } };
    realizadoMark.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    realizadoMark.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(realizadoRowNum, 2, realizadoRowNum, COL_COUNT);
    const realizadoLabel = realizadoRow.getCell(2);
    realizadoLabel.value = 'Realizado — el mantenimiento programado para ese mes ya se ejecutó';
    realizadoLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    realizadoRow.commit();

    const programadoRowNum = ws.rowCount + 1;
    const programadoRow = ws.getRow(programadoRowNum);
    const programadoMark = programadoRow.getCell(1);
    programadoMark.value = '✓';
    programadoMark.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_PROGRAMADO } };
    programadoMark.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    programadoMark.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(programadoRowNum, 2, programadoRowNum, COL_COUNT);
    const programadoLabel = programadoRow.getCell(2);
    programadoLabel.value = 'Programado — el mantenimiento está planificado para ese mes pero aún no se realiza';
    programadoLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    programadoRow.commit();

    logger.info(`cronogramaExport.generateExcel: ${equipos.length} equipos, ${grupos.length} servicios para clienteId=${clienteId}`);
    return { buffer: await workbook.xlsx.writeBuffer(), customer, equipos };
  }
}

export const cronogramaExportService = new CronogramaExportService();
