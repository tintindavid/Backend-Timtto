/**
 * tests/services/inventarioExport.column.test.js
 *
 * Verifies the `EstadoOperativo` column added to the inventory Excel and
 * PDF exports (equipo-estado-operativo-editable-y-cronograma-excel,
 * tasks.md 5.3/5.4). DB-free — EquipoItem/Tenant/Customer statics are
 * monkey-patched (same convention as tests/services/equipoItem.duplicate.test.js);
 * the PDF microservice client is stubbed on the singleton instance so no
 * network call is attempted.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { inventarioExportService } from '../../src/services/inventarioExport.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { Customer } from '../../src/models/customer.model.js';

const TENANT_ID = 'tenant-a';
const CLIENTE_ID = '507f1f77bcf86cd799439001';

function equipos() {
  return [
    { item: 'Monitor', Marca: 'Philips', Modelo: 'M1', Serie: 'S1', Inventario: 'INV1', Ubicacion: 'UCI', Riesgo: 'IIb', Invima: 'REG1', Estado: 'Activo', EstadoOperativo: 'En Reparacion', Servicio: { nombre: 'UCI' } },
    { item: 'Bomba', Marca: 'B.Braun', Modelo: 'M2', Serie: 'S2', Inventario: 'INV2', Ubicacion: 'Urgencias', Riesgo: 'IIb', Invima: 'REG2', Estado: 'Activo', EstadoOperativo: null, Servicio: { nombre: 'Urgencias' } },
  ];
}

function stubFetchData(list) {
  EquipoItem.find = () => ({
    populate() { return this; },
    sort() { return this; },
    lean: () => Promise.resolve(list),
  });
  Tenant.findOne = () => ({ lean: () => Promise.resolve({ tenantId: TENANT_ID, name: 'Timtto' }) });
  Customer.findOne = () => ({ lean: () => Promise.resolve({ _id: CLIENTE_ID, Razonsocial: 'Cliente Demo' }) });
}

describe('inventarioExportService.generateExcel — EstadoOperativo column', () => {
  afterEach(() => {
    delete EquipoItem.find;
    delete Tenant.findOne;
    delete Customer.findOne;
  });

  it('the workbook exposes an "Estado Operativo" column with a value per equipo row', async () => {
    stubFetchData(equipos());

    const buffer = await inventarioExportService.generateExcel(CLIENTE_ID, TENANT_ID);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.getWorksheet('Inventario');

    const headerRow = ws.getRow(3);
    const headers = headerRow.values.filter(Boolean);
    assert.ok(headers.includes('Estado Operativo'), 'header row must include "Estado Operativo"');

    const estadoOperativoColIndex = headerRow.values.findIndex((v) => v === 'Estado Operativo');

    // Collect all non-empty values in that column across the sheet (rows
    // include group-header rows/blank separators too, so filter by content).
    const values = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= 3) return; // skip institutional header + column header rows
      const v = row.getCell(estadoOperativoColIndex).value;
      if (v) values.push(v);
    });

    assert.ok(values.includes('En Reparacion'));
    assert.ok(values.includes('Operativo'), 'fallback to Operativo when EstadoOperativo is falsy');
  });
});

describe('inventarioExportService.generatePDF — EstadoOperativo column', () => {
  afterEach(() => {
    delete EquipoItem.find;
    delete Tenant.findOne;
    delete Customer.findOne;
  });

  it('the generated HTML contains the "Estado Operativo" header and a value per row', async () => {
    stubFetchData(equipos());

    let capturedHtml = null;
    const originalHealthCheck = inventarioExportService.pdfClient.healthCheck;
    const originalGeneratePDF = inventarioExportService.pdfClient.generatePDF;
    inventarioExportService.pdfClient.healthCheck = async () => true;
    inventarioExportService.pdfClient.generatePDF = async (html) => { capturedHtml = html; return Buffer.from('pdf'); };

    try {
      await inventarioExportService.generatePDF(CLIENTE_ID, TENANT_ID);
    } finally {
      inventarioExportService.pdfClient.healthCheck = originalHealthCheck;
      inventarioExportService.pdfClient.generatePDF = originalGeneratePDF;
    }

    assert.ok(capturedHtml.includes('Estado Operativo'));
    assert.ok(capturedHtml.includes('En Reparacion'));
  });
});
