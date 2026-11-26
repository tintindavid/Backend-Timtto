/** Cuentas demo — máximo 5 reportes por OT (ZIP e individual), 2 descargas y marca de agua. DB-free. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { demoLookup } from '../../src/services/demo/demoContext.service.js';
import { withDemoReportSlots } from '../../src/services/demo/demoPdfQuota.service.js';
import { DemoPdfUsage } from '../../src/models/demoPdfUsage.model.js';
import { generateBulkPDFs, generateSinglePDF } from '../../src/controllers/pdfReports.controller.js';
import PDFMicroserviceClient from '../../src/services/pdfMicroserviceClient.js';
import BulkPDFGenerator from '../../src/services/bulkPDFGenerator.js';
import { publicSheetDownloadService } from '../../src/services/publicSheetDownload.service.js';
import { sheetWorkDownloadTokenService } from '../../src/services/sheetWorkDownloadToken.service.js';
import { Report } from '../../src/models/report.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { Tenant } from '../../src/models/tenant.model.js';

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

const SHEET = '65a1b2c3d4e5f6a7b8c9d0e1';
// Unsorted on purpose: the selection must be the same five on every download.
const report = (n, orden = 'ot1') => ({ _id: `r${n}`, consecutivo: `R00000${n}`, orden });
const reports = () => [7, 2, 5, 1, 6, 3, 4].map((n) => report(n));

let used;
let generated;
let slots;
beforeEach(() => {
  slots = new Map();
  used = 0;
  generated = [];
  // Demo created before the limit existed: it has no `reportsPerOt` stored.
  stub(demoLookup, 'find', async (t) => (t === 'demo1' ? { demo: { enabled: true, limits: { pdfPerDocument: 2 } } } : null));
  stub(DemoPdfUsage, 'findOneAndUpdate', async (f, update, options) => {
    if (f.docType === 'report') return { used: 1 };
    if (f.docType === 'otReports') {
      // Mimics the unique index: a full order does not match, so the upsert collides.
      const held = slots.get(f.docId);
      const id = update.$addToSet.reportIds;
      if (held && !held.includes(id) && held.length >= 5) {
        if (options.upsert) throw Object.assign(new Error('dup'), { code: 11000 });
        return null;
      }
      const before = held ? { reportIds: [...held] } : null;
      slots.set(f.docId, [...new Set([...(held ?? []), id])]);
      return before;
    }
    assert.equal(f.docType, 'reportsZip');
    assert.equal(f.docId, SHEET);
    if (used >= 2) return null;
    used += 1;
    return { used };
  });
  stub(DemoPdfUsage, 'updateOne', async (f, update) => {
    if (f.docType === 'otReports') slots.set(f.docId, slots.get(f.docId).filter((id) => id !== update.$pull.reportIds));
    else used -= 1;
  });
  const query = { lean: () => query, populate: () => query, then: (ok) => ok(reports()) };
  stub(Report, 'find', () => query);
  stub(Repuestos, 'find', () => ({ lean: async () => [] }));
  stub(Tenant, 'findOne', () => ({ lean: async () => ({ tenantId: 'demo1', name: 'Demo' }) }));
  stub(BulkPDFGenerator.prototype, 'generateBulkPDFs', async (list, _html, options) => {
    generated.push({ ids: list.map((r) => r._id), tenantId: options.tenantId });
    return Buffer.from('zip');
  });
});

async function bulk(tenantId, body) {
  const res = { setHeader() {}, send() { this.sent = true; return this; }, status() { return this; }, json() { return this; } };
  let error;
  await generateBulkPDFs({ tenantId, body }, res, (e) => { error = e; });
  return { res, error };
}

const take = (tenantId, list, generate = async (allowed) => allowed.map((r) => r._id)) => withDemoReportSlots(tenantId, list, generate);

describe('reports per work order', () => {
  it('keeps the first five by consecutive in a demo and everything elsewhere', async () => {
    assert.deepEqual(await take('demo1', reports()), ['r1', 'r2', 'r3', 'r4', 'r5']);
    assert.equal((await take('acme', reports())).length, 7);
  });

  it('shares the five reports between downloads of the same order, and separates orders', async () => {
    for (const n of [7, 6, 5]) await take('demo1', [report(n)]);
    assert.deepEqual(await take('demo1', reports()), ['r1', 'r2', 'r5', 'r6', 'r7'], 'held ones plus the first free');
    await assert.rejects(() => take('demo1', [report(3)]), (e) => e.code === 'DEMO_PDF_LIMIT_REACHED');
    assert.deepEqual(await take('demo1', [report(6)]), ['r6']);
    assert.deepEqual(await take('demo1', [report(8, { _id: 'ot2' })]), ['r8']);
  });

  it('frees only the slots taken by a failed generation', async () => {
    await take('demo1', [report(1)]);
    await assert.rejects(() => take('demo1', [report(1), report(2)], async () => { throw new Error('pdf down'); }), /pdf down/);
    assert.deepEqual(slots.get('ot1'), ['r1']);
  });
});

describe('individual report download in a demo', () => {
  const single = async (n) => {
    stub(Report, 'findOne', () => ({ lean: async () => report(n) }));
    stub(PDFMicroserviceClient.prototype, 'generatePDF', async () => Buffer.from('pdf'));
    const res = { setHeader() {}, send() { this.sent = true; return this; }, status() { return this; }, json() { return this; } };
    let error;
    await generateSinglePDF({ tenantId: 'demo1', body: { reportId: `r${n}` }, params: {} }, res, (e) => { error = e; });
    return error?.code ?? (res.sent && 'sent');
  };

  it('rejects the sixth report of an order', async () => {
    for (const n of [1, 2, 3, 4, 5]) assert.equal(await single(n), 'sent');
    assert.equal(await single(6), 'DEMO_PDF_LIMIT_REACHED');
  });
});

describe('POST /pdf-reports/bulk in a demo', () => {
  it('generates at most five reports of the sheet, twice', async () => {
    for (let i = 0; i < 2; i += 1) assert.equal((await bulk('demo1', { sheetworkId: SHEET })).res.sent, true);
    assert.deepEqual(generated[0], { ids: ['r1', 'r2', 'r3', 'r4', 'r5'], tenantId: 'demo1' });
    const third = await bulk('demo1', { sheetworkId: SHEET });
    assert.equal(third.error.code, 'DEMO_PDF_LIMIT_REACHED');
    assert.equal(generated.length, 2);
  });

  it('only accepts a worksheet, so the limit per sheet cannot be sidestepped', async () => {
    for (const body of [{ reportIds: ['r6'] }, { otId: SHEET }, { filters: { estado: 'Cerrado' } }, { sheetworkId: SHEET, reportIds: ['r6'] }]) {
      assert.equal((await bulk('demo1', body)).error.code, 'DEMO_FEATURE_BLOCKED', JSON.stringify(body));
    }
    assert.equal(generated.length, 0);
  });

  it('leaves regular tenants unchanged', async () => {
    assert.equal((await bulk('acme', { reportIds: ['r6'] })).res.sent, true);
    assert.equal(generated[0].ids.length, 7);
    assert.equal(used, 0);
  });
});

describe('public share link ZIP in a demo', () => {
  const token = { _id: 't', tenantId: 'demo1', sheetId: SHEET, allowReports: true };

  it('does not spend the link once the sheet quota is exhausted', async () => {
    used = 2;
    stub(sheetWorkDownloadTokenService, 'incrementReportDownload', async () => { throw new Error('must not spend'); });
    await assert.rejects(() => publicSheetDownloadService.streamReportsZip(token), (e) => e.code === 'DEMO_PDF_LIMIT_REACHED');
  });
});
