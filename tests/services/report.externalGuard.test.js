/**
 * Services registered as external are managed only from their own endpoints (adversarial F2).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { reportService } from '../../src/services/report.service.js';
import { Report } from '../../src/models/report.model.js';

const T = 'tenant-a';
const ID = '507f1f77bcf86cd799439099';
const lean = (v) => ({ lean: () => Promise.resolve(v) });

let writes;
function arrange(doc) {
  writes = [];
  Report.findById = () => lean(doc);
  Report.findOne = () => lean(doc);
  Report.findByIdAndUpdate = async (...a) => { writes.push(a); return { _id: ID }; };
  Report.findOneAndUpdate = async (...a) => { writes.push(a); return { _id: ID }; };
}
const external = { _id: ID, tenantId: T, origen: 'externo', estado: 'Cerrado', tipoMtto: 'Preventivo' };
const internal = { _id: ID, tenantId: T, estado: 'Pendiente', tipoMtto: 'Preventivo' };

const refuses = (p) => assert.rejects(p, (e) => { assert.equal(e.statusCode, 409); assert.equal(e.code, 'EXTERNAL_REPORT_IMMUTABLE'); return true; });

describe('external reports are protected from the work-order endpoints', () => {
  afterEach(() => {
    delete Report.findById; delete Report.findOne; delete Report.findByIdAndUpdate; delete Report.findOneAndUpdate;
  });

  it('update refuses an external report and writes nothing', async () => {
    arrange(external);
    await refuses(reportService.update(ID, { tipoMtto: 'Correctivo', isDeleted: true }, T));
    assert.equal(writes.length, 0);
  });

  it('procesar refuses an external report and writes nothing', async () => {
    arrange(external);
    await refuses(reportService.procesar(ID, { estado: 'Procesado' }, T));
    assert.equal(writes.length, 0);
  });

  it('unprocess refuses an external report and writes nothing', async () => {
    arrange({ ...external, estado: 'Procesado' });
    await refuses(reportService.unprocess(ID, T));
    assert.equal(writes.length, 0);
  });

  it('update never lets an internal report become external', async () => {
    arrange(internal);
    await reportService.update(ID, { observacion: 'x', origen: 'externo', externo: { proveedor: 'p' }, 'externo.proveedor': 'q', 'origen.x': 1 }, T);
    const set = writes[0][1].$set;
    assert.deepEqual(Object.keys(set), ['observacion']);
    assert.equal(set.observacion, 'x');
  });
});
