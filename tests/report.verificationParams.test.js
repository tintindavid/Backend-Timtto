import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { reportService } from '../src/services/report.service.js';
import { Report } from '../src/models/report.model.js';
import { ApiError } from '../src/utils/apiError.util.js';

describe('reportService.updateVerificationParams', () => {
  let originalFindOneAndUpdate;
  let lastFilterUsed;
  let lastUpdateUsed;

  beforeEach(() => {
    originalFindOneAndUpdate = Report.findOneAndUpdate;
    lastFilterUsed = null;
    lastUpdateUsed = null;
  });

  afterEach(() => {
    Report.findOneAndUpdate = originalFindOneAndUpdate;
  });

  function stubFindOneAndUpdate(returnValue) {
    Report.findOneAndUpdate = async (filter, update) => {
      lastFilterUsed = filter;
      lastUpdateUsed = update;
      return returnValue;
    };
  }

  it('replaces the verificationParam array with sanitized rows', async () => {
    const persisted = {
      _id: 'r1',
      tenantId: 't1',
      verificationParam: [
        { magnitud: 'Voltaje', unidad: 'V', valorReferencia: 12, valorMedido: 12.6, patron: 'Fluke 87V' },
      ],
    };
    stubFindOneAndUpdate(persisted);

    const result = await reportService.updateVerificationParams('r1', 't1', [
      { magnitud: '  Voltaje  ', unidad: ' V ', valorReferencia: 12, valorMedido: 12.6, patron: ' Fluke 87V ' },
    ]);

    assert.equal(result, persisted);
    assert.deepEqual(lastUpdateUsed.$set.verificationParam, [
      { magnitud: 'Voltaje', unidad: 'V', valorReferencia: 12, valorMedido: 12.6, patron: 'Fluke 87V' },
    ]);
  });

  it('strips fully-empty rows but keeps rows with only magnitud or only patron', async () => {
    stubFindOneAndUpdate({ _id: 'r1', tenantId: 't1', verificationParam: [] });

    await reportService.updateVerificationParams('r1', 't1', [
      { magnitud: 'Voltaje', unidad: 'V', valorReferencia: null, valorMedido: null, patron: '' },
      { magnitud: '', unidad: '', valorReferencia: null, valorMedido: null, patron: '' },
      { magnitud: '', unidad: '', valorReferencia: null, valorMedido: null, patron: 'Fluke 87V' },
      {},
    ]);

    assert.equal(lastUpdateUsed.$set.verificationParam.length, 2);
    assert.equal(lastUpdateUsed.$set.verificationParam[0].magnitud, 'Voltaje');
    assert.equal(lastUpdateUsed.$set.verificationParam[1].patron, 'Fluke 87V');
  });

  it('accepts an empty array and clears the stored verificationParam', async () => {
    stubFindOneAndUpdate({ _id: 'r1', tenantId: 't1', verificationParam: [] });

    await reportService.updateVerificationParams('r1', 't1', []);

    assert.deepEqual(lastUpdateUsed.$set.verificationParam, []);
  });

  it('coerces numeric strings into Numbers and preserves nulls', async () => {
    stubFindOneAndUpdate({ _id: 'r1', tenantId: 't1', verificationParam: [] });

    await reportService.updateVerificationParams('r1', 't1', [
      { magnitud: 'Presion', unidad: 'PSI', valorReferencia: '120', valorMedido: '119.5', patron: 'Gauge' },
      { magnitud: 'Temp', unidad: 'C', valorReferencia: null, valorMedido: 36.6, patron: '' },
    ]);

    const persisted = lastUpdateUsed.$set.verificationParam;
    assert.equal(typeof persisted[0].valorReferencia, 'number');
    assert.equal(persisted[0].valorReferencia, 120);
    assert.equal(persisted[0].valorMedido, 119.5);
    assert.equal(persisted[1].valorReferencia, null);
    assert.equal(persisted[1].valorMedido, 36.6);
  });

  it('filters by tenantId at the database level', async () => {
    stubFindOneAndUpdate({ _id: 'r1', tenantId: 't1', verificationParam: [] });

    await reportService.updateVerificationParams('r1', 't1', []);

    assert.equal(lastFilterUsed.tenantId, 't1');
    assert.equal(lastFilterUsed._id, 'r1');
  });

  it('throws ApiError 404 when the Report does not exist for the tenant', async () => {
    stubFindOneAndUpdate(null);

    await assert.rejects(
      () => reportService.updateVerificationParams('r1', 't1', []),
      (err) => err instanceof ApiError && err.statusCode === 404 && err.code === 'REPORT_NOT_FOUND'
    );
  });

  it('throws when tenantId is missing', async () => {
    await assert.rejects(() =>
      reportService.updateVerificationParams('r1', undefined, [])
    );
  });
});
