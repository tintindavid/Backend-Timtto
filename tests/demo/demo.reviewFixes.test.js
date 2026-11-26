/** Cuentas demo — hallazgos de la revisión final. DB-free. */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { applyDemoWatermark } from '../../src/utils/demoWatermark.util.js';
import { withDemoPdfQuota } from '../../src/services/demo/demoPdfQuota.service.js';
import { demoLookup } from '../../src/services/demo/demoContext.service.js';
import { DemoPdfUsage } from '../../src/models/demoPdfUsage.model.js';
import customerRoutes from '../../src/routes/customer.routes.js';
import { PublicSheetSignService } from '../../src/services/publicSheetSign.service.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Tenant } from '../../src/models/tenant.model.js';

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });
const asDemo = () => stub(demoLookup, 'find', async () => ({ demo: { enabled: true, limits: { pdfPerDocument: 2 } } }));

const marks = (html) => html.match(/DEMO – sin validez/g)?.length ?? 0;

describe('watermark cannot be switched off from content', () => {
  it('marks a document whose text mentions the marker', () => {
    const out = applyDemoWatermark('<body><p>data-demo-watermark</p></body>');
    assert.equal(marks(out), 1);
  });

  it('moves an injected copy of the block to the real position and stays idempotent', () => {
    const once = applyDemoWatermark('<body></body>');
    const block = once.slice('<body>'.length, -'</body>'.length);
    const injected = applyDemoWatermark(`<body><!--${block}--><p>x</p></body>`);
    assert.ok(injected.endsWith(`${block}</body>`));
    assert.equal(applyDemoWatermark(once), once);
  });
});

describe('PDF quota id normalization', () => {
  it('counts the same document whatever the letter case of its id', async () => {
    asDemo();
    const seen = [];
    stub(DemoPdfUsage, 'findOneAndUpdate', async (f) => { seen.push(f.docId); return { used: 1 }; });
    await withDemoPdfQuota('demo1', 'sheetwork', ['65A1B2C3D4E5F6A7B8C9D0E1'], async () => 'pdf');
    await withDemoPdfQuota('demo1', 'informeOt', ['65a1b2c3d4e5f6a7b8c9d0e1', '65A1B2C3D4E5F6A7B8C9D0E1'], async () => 'pdf');
    assert.deepEqual(seen, ['65a1b2c3d4e5f6a7b8c9d0e1', '65a1b2c3d4e5f6a7b8c9d0e1']);
  });
});

describe('inventory export', () => {
  it('is blocked when `formato` is omitted or empty (the controller defaults to Excel)', async () => {
    asDemo();
    const layer = customerRoutes.stack.find((l) => l.route?.path === '/:id/inventario');
    const guard = layer.route.stack.map((s) => s.handle).find((h) => h.demoFeature);
    for (const query of [{}, { formato: '' }, { formato: 'excel' }]) {
      const error = await new Promise((resolve) => guard({ tenantId: 'demo1', query }, {}, resolve));
      assert.equal(error?.code, 'DEMO_FEATURE_BLOCKED', JSON.stringify(query));
    }
  });
});

describe('remote signature page', () => {
  const setup = (status) => {
    stub(sheetWorkSignTokenService, 'resolveByToken', async () => ({ status, doc: { tenantId: 'demo1', sheetId: 's1' } }));
    const sheet = { _id: 's1', estado: 'Firmada', pdfStatus: 'ready' };
    const query = { populate: () => query, lean: async () => sheet };
    stub(SheetWork, 'findOne', () => query);
    stub(Tenant, 'findOne', () => ({ lean: async () => ({ name: 'Demo' }) }));
    const service = new PublicSheetSignService();
    stub(service.pdfService, 'generateHTML', () => '<body>hoja</body>');
    return service;
  };

  it('watermarks both previews', async () => {
    asDemo();
    const service = setup('active');
    assert.equal(marks((await service.getForToken('t')).previewHtml), 1);
    assert.equal(marks(await service.getPreviewHtmlForToken('t')), 1);
  });

  it('tells the page there is no download in a demo account', async () => {
    asDemo();
    assert.equal((await setup('signed').getForToken('t')).downloadUnavailable, true);
  });

  it('does not add the flag for regular tenants', async () => {
    stub(demoLookup, 'find', async () => null);
    assert.equal('downloadUnavailable' in (await setup('signed').getForToken('t')), false);
  });
});
