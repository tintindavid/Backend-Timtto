import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildInformePorOtXlsx, INFORME_OT_XLSX_HEADERS } from '../../src/services/informeXlsxByOt.service.js';

const row = (o = {}) => ({
  consecutivo: 'R1', otConsecutivo: 'OT-1', equipoNombre: 'Monitor', marca: 'M', modelo: 'X', serie: 'S',
  inventario: 'I', ubicacion: 'U', sede: 'A', servicio: 'UCI', estadoOperativo: 'Operativo',
  estadoReporte: 'Cumplido', fechaRealizado: '01/01/2026', tecnico: 'Juan', ...o,
});

async function load(payload) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildInformePorOtXlsx(payload));
  return wb.getWorksheet('Equipos');
}

describe('buildInformePorOtXlsx', () => {
  it('writes one row per reporte across all secciones with the expected header', async () => {
    const ws = await load({
      secciones: [
        { sede: 'A', servicio: 'UCI', reportes: [row(), row({ consecutivo: 'R2' })] },
        { sede: 'B', servicio: 'Urg', reportes: [row({ consecutivo: 'R3', sede: 'B', servicio: 'Urg' })] },
      ],
    });
    assert.equal(ws.rowCount, 4);
    assert.deepEqual(ws.getRow(1).values.slice(1), INFORME_OT_XLSX_HEADERS);
    assert.equal(ws.getRow(1).font.bold, true);
    assert.equal(ws.getRow(4).getCell(1).value, 'R3');
    assert.equal(ws.views[0].state, 'frozen');
    assert.ok(ws.autoFilter);
    assert.equal(Object.keys(ws._merges || {}).length, 0);
  });

  it('neutralizes formulas in text cells', async () => {
    const ws = await load({ secciones: [{ sede: 'A', servicio: 'S', reportes: [row({ ubicacion: '=HYPERLINK("http://x")' })] }] });
    assert.equal(ws.getRow(2).getCell(8).value, "'=HYPERLINK(\"http://x\")");
  });

  it('empty payload still yields header only', async () => {
    const ws = await load({ secciones: [] });
    assert.equal(ws.rowCount, 1);
  });
});
