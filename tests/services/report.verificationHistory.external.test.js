/**
 * tests/services/report.verificationHistory.external.test.js
 * reportes-externos-mp-mc, scenario "Verification parameters feed the VP history". The existing history query
 * is unchanged: it reads any non-cancelled report of the equipment that has measured rows, whatever its origin.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ReportService } from '../../src/services/report.service.js';
import { Report } from '../../src/models/report.model.js';

const original = Report.find;
afterEach(() => { Report.find = original; });

describe('historyVerificationParams with external reports', () => {
  it('includes the measurements of an external preventive report next to the internal ones', async () => {
    let filter;
    Report.find = (f) => {
      filter = f;
      const rows = [
        { _id: 'a', consecutivo: 'R000010', fechaProcesado: new Date('2026-01-10'), origen: 'interno', verificationParam: [{ magnitud: 'Presion', unidad: 'mmHg', valorReferencia: 120, valorMedido: 119, patron: 'F' }] },
        { _id: 'b', consecutivo: 'R000123', fechaProcesado: new Date('2026-03-12'), origen: 'externo', verificationParam: [{ magnitud: 'Presion', unidad: 'mmHg', valorReferencia: 120, valorMedido: 118.5, patron: 'Fluke' }] },
      ];
      const q = { select: () => q, sort: () => q, lean: () => Promise.resolve(rows) };
      return q;
    };
    const { measurements } = await new ReportService().historyVerificationParams('507f1f77bcf86cd799439011', 't1');
    assert.deepEqual(measurements.map((m) => m.consecutivo), ['R000010', 'R000123']);
    assert.equal(measurements[1].valorMedido, 118.5);
    // the query does not filter by origin or by work order
    assert.equal(filter.tenantId, 't1');
    assert.equal(filter.origen, undefined);
    assert.equal(filter.orden, undefined);
    assert.deepEqual(filter.estado, { $ne: 'Cancelado' });
    assert.equal(filter.isDeleted, false);
  });
});
