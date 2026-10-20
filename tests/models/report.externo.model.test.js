/**
 * tests/models/report.externo.model.test.js
 * reportes-externos-mp-mc, task 1.1. The new fields are additive: a report created the way an OT creates
 * it is unchanged.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Report } from '../../src/models/report.model.js';
import { calcularProximoMtto } from '../../src/services/report.service.js';

describe('Report additive fields', () => {
  it('a report built like the work-order flow has origen "interno" and no externo block', () => {
    const r = new Report({ tenantId: 't', consecutivo: 'R000001', estado: 'Pendiente', tipoMtto: 'Preventivo' });
    assert.equal(r.origen, 'interno');
    assert.equal(r.externo, undefined);
    assert.equal(r.validateSync(), undefined);
  });

  it('origen only allows interno or externo', () => {
    const r = new Report({ tenantId: 't', origen: 'tercero' });
    assert.ok(r.validateSync()?.errors?.origen);
  });

  it('an external report keeps the provider block', () => {
    const r = new Report({
      tenantId: 't', origen: 'externo',
      externo: { proveedor: 'Taller', consecutivoDocumento: 'C-1', enlace: 'https://x.example/c', registradoPor: '507f1f77bcf86cd799439031' },
    });
    assert.equal(r.validateSync(), undefined);
    assert.equal(r.externo.proveedor, 'Taller');
    assert.equal(r.externo.proveedorId, null);
  });

  it('the link of the external block must be http(s)', () => {
    const r = new Report({ tenantId: 't', origen: 'externo', externo: { proveedor: 'T', enlace: 'javascript:alert(1)' } });
    assert.ok(r.validateSync()?.errors?.['externo.enlace']);
  });

  it('the storage path of the document is never selected by default nor serialized', () => {
    assert.equal(Report.schema.path('externo.documento.storagePath').options.select, false);
    const r = new Report({ tenantId: 't', externo: { proveedor: 'T', documento: { url: 'https://x/d', storagePath: 'secret/path.pdf', nombreOriginal: 'd.pdf' } } });
    const json = JSON.parse(JSON.stringify(r.toJSON()));
    assert.equal(json.externo.documento.url, 'https://x/d');
    assert.equal(JSON.stringify(json).includes('secret/path.pdf'), false);
  });

  it('has the index by tenant, equipment and origin', () => {
    const has = Report.schema.indexes().some(([fields]) => fields.tenantId === 1 && fields.Equipo === 1 && fields.origen === 1);
    assert.equal(has, true);
  });
});

describe('calcularProximoMtto (exported without changes)', () => {
  it('returns the next scheduled month after the current one', () => {
    assert.equal(calcularProximoMtto('mar', ['mar', 'sep']), 'sep');
    assert.equal(calcularProximoMtto('ene', ['mar', 'sep']), 'mar');
  });

  it('wraps to the first month of the cycle', () => {
    assert.equal(calcularProximoMtto('sep', ['mar', 'sep']), 'mar');
    assert.equal(calcularProximoMtto('dic', ['mar', 'sep']), 'mar');
  });

  it('is case insensitive and tolerates an unsorted list', () => {
    assert.equal(calcularProximoMtto('MAR', ['SEP', 'Mar']), 'sep');
  });
});
