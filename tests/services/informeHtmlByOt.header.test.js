/**
 * Verifies the tenant banner (logos + tenant name) lives in the <thead> of the
 * page wrapper so the PDF engine repeats it on every printed page. Pure function — no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildInformeHtmlByOt } from '../../src/services/informeHtmlByOt.service.js';

const payload = {
  meta: {
    clienteNombre: 'ACME S.A.S', clienteLogo: 'https://cdn.example.com/c.png',
    tenantNombre: 'Tenant Demo', tenantLogo: 'https://cdn.example.com/t.png',
    fechaGeneracion: new Date().toISOString(), otsSeleccionadas: [],
  },
  kpis: { cumplimientoPct: 100, totalReportes: 1, cumplidos: 1, pendientes: 0, cancelados: 0, correctivos: 0, repuestosInstalados: 0, costoTotal: 0, horasServicio: 1 },
  secciones: [],
  observacionesReportes: [],
  observacionGeneral: '',
};

describe('buildInformeHtmlByOt — repeated tenant header', () => {
  const html = buildInformeHtmlByOt(payload);

  it('renders the tenant banner exactly once, inside <thead>', () => {
    assert.equal(html.split('class="tenant-header"').length - 1, 1);
    const thead = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    assert.match(thead, /class="tenant-header"/);
    assert.match(thead, /Tenant Demo/);
    assert.match(thead, /t\.png/);
    assert.match(thead, /c\.png/);
  });

  it('keeps the body free of the banner and keeps the repeating footer', () => {
    const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    assert.doesNotMatch(tbody, /class="tenant-header"/);
    assert.match(html, /<tfoot>/);
    assert.match(html, /\.page-wrapper thead \{ display: table-header-group; \}/);
  });
});

describe('buildInformeHtmlByOt — signature block', () => {
  const html = buildInformeHtmlByOt(payload);

  it('is compact and never split across pages', () => {
    assert.match(html, /\.report-footer \{ margin-top:0;[^}]*break-inside:avoid/);
    assert.match(html, /\.report-footer \.signature-box \{[^}]*break-inside:avoid/);
  });

  it('keeps the signature image, line, name and role in one box', () => {
    const box = html.slice(html.indexOf('<div class="signature-box">'), html.indexOf('</div>\n        <div class="signature-box">'));
    assert.match(box, /signature-line/);
    assert.match(box, /signature-name/);
    assert.match(box, /signature-role/);
  });
});

describe('buildInformeHtmlByOt — generation stamp', () => {
  const html = buildInformeHtmlByOt(payload);

  it('shows the generation date and time in the client block, not in the signature footer', () => {
    assert.doesNotMatch(html, /Informe generado el/);
    assert.match(html, /<span class="cg-label">Generado:<\/span>/);
    const footer = html.slice(html.indexOf('<div class="report-footer">'), html.indexOf('</div>\n    </div>', html.indexOf('<div class="report-footer">')));
    assert.doesNotMatch(footer, /Tenant Demo/);
  });
});
