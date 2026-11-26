/** Cuentas demo — Tarea 4: cupo de PDF. DB-free. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DEMO_LIMITS } from '../../src/constants/demo.constants.js';
import { withDemoPdfQuota } from '../../src/services/demo/demoPdfQuota.service.js';
import { demoLookup } from '../../src/services/demo/demoContext.service.js';
import { DemoPdfUsage } from '../../src/models/demoPdfUsage.model.js';
import { publicSheetDownloadService } from '../../src/services/publicSheetDownload.service.js';
import { sheetWorkDownloadTokenService } from '../../src/services/sheetWorkDownloadToken.service.js';
import { clientPortalService } from '../../src/services/clientPortal.service.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

let usage;
beforeEach(() => {
  usage = new Map();
  stub(demoLookup, 'find', async (tenantId) => (tenantId.startsWith('demo')
    ? { demo: { enabled: true, limits: { ...DEMO_LIMITS } } } : null));
  const keyOf = (f) => `${f.tenantId}|${f.docType}|${f.docId}`;
  stub(DemoPdfUsage, 'findOneAndUpdate', async (f, u, o = {}) => {
    const key = keyOf(f);
    if (!usage.has(key)) {
      if (!o.upsert) return null;
      usage.set(key, u.$inc.used);
      return { used: u.$inc.used };
    }
    if (usage.get(key) >= f.used.$lt) {
      if (o.upsert) throw Object.assign(new Error('dup'), { code: 11000 });
      return null;
    }
    usage.set(key, usage.get(key) + u.$inc.used);
    return { used: usage.get(key) };
  });
  stub(DemoPdfUsage, 'updateOne', async (f, u) => {
    const key = keyOf(f);
    if (usage.get(key) > 0) usage.set(key, usage.get(key) + u.$inc.used);
    return {};
  });
});

const ok = async () => 'pdf';
const exhausted = (e) => e.statusCode === 403 && e.code === 'DEMO_PDF_LIMIT_REACHED' && e.details.limit === 2;

describe('withDemoPdfQuota', () => {
  it('allows two downloads per document and rejects the third', async () => {
    await withDemoPdfQuota('demo1', 'sheetwork', ['s1'], ok);
    await withDemoPdfQuota('demo1', 'sheetwork', ['s1'], ok);
    await assert.rejects(() => withDemoPdfQuota('demo1', 'sheetwork', ['s1'], async () => { throw new Error('must not render'); }), exhausted);
  });

  it('does not consume when generation fails', async () => {
    await assert.rejects(() => withDemoPdfQuota('demo1', 'report', ['r1'], async () => { throw new Error('pdf down'); }), /pdf down/);
    assert.equal(usage.get('demo1|report|r1'), 0);
  });

  it('allows exactly two concurrent downloads', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => withDemoPdfQuota('demo1', 'report', ['r2'], ok)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  });

  it('gives back the other OTs when one of them is exhausted, and ignores repeated ids', async () => {
    usage.set('demo1|informeOt|b', 2);
    await assert.rejects(() => withDemoPdfQuota('demo1', 'informeOt', ['a', 'b', 'c'], ok), exhausted);
    assert.equal(usage.get('demo1|informeOt|a'), 0);
    assert.equal(usage.get('demo1|informeOt|c') ?? 0, 0);
    await withDemoPdfQuota('demo1', 'informeOt', ['z', 'z'], ok);
    assert.equal(usage.get('demo1|informeOt|z'), 1);
  });

  it('counts per tenant and ignores regular tenants', async () => {
    await withDemoPdfQuota('demo1', 'sheetwork', ['s1'], ok);
    await withDemoPdfQuota('demo2', 'sheetwork', ['s1'], ok);
    await withDemoPdfQuota('acme', 'sheetwork', ['s1'], ok);
    assert.equal(usage.get('demo1|sheetwork|s1'), 1);
    assert.equal(usage.get('demo2|sheetwork|s1'), 1);
    assert.equal(usage.has('acme|sheetwork|s1'), false);
  });
});

describe('public share link', () => {
  it('shares the counter with the panel and does not spend the token when exhausted', async () => {
    usage.set('demo1|sheetwork|s9', 2);
    stub(sheetWorkDownloadTokenService, 'incrementHtDownload', async () => { throw new Error('must not spend the token'); });
    await assert.rejects(() => publicSheetDownloadService.streamHtPdf({ _id: 't', tenantId: 'demo1', sheetId: 's9' }), exhausted);
  });
});

describe('client portal', () => {
  it('renders the signed sheet on demand under the quota instead of redirecting to a stored file', async () => {
    stub(ClientAccessToken, 'findById', () => ({ select: () => ({ lean: async () => ({ otIds: ['o1'] }) }) }));
    stub(SheetWork, 'findOne', () => ({ lean: async () => ({ _id: 's5', numeroHoja: 'H0001', pdfStatus: 'pending' }) }));
    stub(clientPortalService.pdfService, 'generatePDF', async () => Buffer.from('%PDF'));
    const id = '507f1f77bcf86cd799439011';
    const first = await clientPortalService.getSheetPdfLocation('demo1', 't', id);
    assert.equal(first.filename, 'HT-H0001.pdf');
    assert.ok(Buffer.isBuffer(first.buffer));
    await clientPortalService.getSheetPdfLocation('demo1', 't', id);
    await assert.rejects(() => clientPortalService.getSheetPdfLocation('demo1', 't', id), exhausted);
  });

  it('never stores a signed-sheet PDF for a demo', async () => {
    const updates = [];
    stub(SheetWork, 'find', () => ({ lean: async () => [{ _id: 's6' }] }));
    stub(SheetWork, 'updateOne', async (f, u) => { updates.push(u.$set); return {}; });
    stub(firebaseStorageService, 'uploadPdf', async () => { throw new Error('must not upload'); });
    await clientPortalService.generatePdfsForBatch('b1', 'demo1');
    assert.deepEqual(updates, [{ pdfStatus: 'ready' }]);
  });
});
