/** Cuentas demo — Tarea 3: marca de agua en PDF y vistas previas. DB-free. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

import { applyDemoWatermark, watermarkIfDemo } from '../../src/utils/demoWatermark.util.js';
import PDFMicroserviceClient from '../../src/services/pdfMicroserviceClient.js';
import { demoLookup } from '../../src/services/demo/demoContext.service.js';

const MARK = 'DEMO – sin validez';
const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

let sent;
beforeEach(() => {
  sent = [];
  stub(demoLookup, 'find', async (tenantId) => (tenantId === 'demo1' ? { demo: { enabled: true, limits: {} } } : null));
  stub(axios, 'post', async (_url, body) => { sent.push(body); return { data: Buffer.from('%PDF') }; });
});

const count = (s) => s.split(MARK).length - 1;
const HTML = '<html><body><p>hola</p></body></html>';

describe('watermark', () => {
  it('goes before </body> once, even if applied twice or without a body tag', () => {
    const once = applyDemoWatermark(HTML);
    assert.equal(count(once), 1);
    assert.ok(once.indexOf(MARK) < once.indexOf('</body>'));
    assert.equal(applyDemoWatermark(once), once);
    assert.equal(count(applyDemoWatermark('<p>x</p>')), 1);
  });

  it('watermarkIfDemo leaves a regular tenant untouched', async () => {
    assert.equal(await watermarkIfDemo(HTML, 'normal'), HTML);
    assert.equal(count(await watermarkIfDemo(HTML, 'demo1')), 1);
  });
});

describe('PDFMicroserviceClient', () => {
  it('watermarks demo PDFs and sends the exact HTML for regular tenants', async () => {
    const client = new PDFMicroserviceClient();
    await client.generatePDF(HTML, {}, { tenantId: 'demo1' });
    await client.generatePDF(HTML, {}, { tenantId: 'normal' });
    assert.equal(count(sent[0].html), 1);
    assert.equal(sent[1].html, HTML);
  });

  it('fails closed without tenantId, before calling the microservice', async () => {
    await assert.rejects(() => new PDFMicroserviceClient().generatePDF(HTML),
      (e) => e.statusCode === 500 && e.code === 'PDF_TENANT_REQUIRED');
    assert.equal(sent.length, 0);
  });
});

describe('static guard', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return full.endsWith('.js') ? [full] : [];
  });

  it('every call to the microservice client passes tenantId', () => {
    const offenders = [];
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');
      // Calls on a client instance (pdfClient, this._client(), new PDFMicroserviceClient(), client).
      const re = /(?:[Cc]lient(?:\(\))?)\.generatePDF\(([\s\S]*?)\);/g;
      for (const m of src.matchAll(re)) {
        if (!m[1].includes('tenantId')) offenders.push(`${path.relative(root, file)}: ${m[0].slice(0, 80)}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('the three HTML previews are watermarked', () => {
    const portal = fs.readFileSync(path.join(root, 'services/clientPortal.service.js'), 'utf8');
    const crono = fs.readFileSync(path.join(root, 'controllers/cronograma.controller.js'), 'utf8');
    assert.equal(portal.split('watermarkIfDemo(').length - 1 >= 2, true);
    assert.ok(crono.includes('watermarkIfDemo('));
  });
});

describe('supplier portal purchase order', () => {
  it('names the tenant of the requisition when rendering', async () => {
    const { requisicionPortalPublicoService: portal } = await import('../../src/services/requisicionPortalPublico.service.js');
    const calls = [];
    stub(portal.deps, 'pdf', { renderParts: async (_oc, _view, logCtx) => { calls.push(logCtx); return {}; } });
    stub(portal, '_ocOr404', () => ({ numero: 'OC-1' }));
    await portal.pdfOrdenCompra({ tenantNombre: 'T', row: { tenantId: 'demo1', _id: 'r1', proveedor: { nombre: 'P' } } });
    assert.equal(calls[0].tenantId, 'demo1');
  });
});
