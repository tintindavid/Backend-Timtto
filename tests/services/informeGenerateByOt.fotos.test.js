/**
 * DB-free tests for fotos / observaciones adicionales / evidencias listing of informeGenerateByOt.service.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { informeGenerateByOtService } from '../../src/services/informeGenerateByOt.service.js';
import { Customer } from '../../src/models/customer.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { buildInformeHtmlByOt } from '../../src/services/informeHtmlByOt.service.js';

const TENANT_A = 'tenant-a';
const CLIENTE_ID = '507f1f77bcf86cd799439001';
const OT_ID = '507f1f77bcf86cd799439010';
const EV1 = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const EV2 = 'aaaaaaaaaaaaaaaaaaaaaaa2';
const EV3 = 'aaaaaaaaaaaaaaaaaaaaaaa3';
const EV_OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const chainable = (result) => {
  const obj = { select() { return obj; }, populate() { return obj; }, lean: () => Promise.resolve(result) };
  return obj;
};

function report(id, consecutivo, evidencias, extra = {}) {
  return {
    _id: id, tenantId: TENANT_A, ClienteId: CLIENTE_ID, Equipo: 'eq-1', consecutivo,
    estado: 'Cerrado', tipoMtto: 'Preventivo', duracion: 45, observacion: '',
    equipoSnapshot: { ItemText: 'Monitor', Sede: 'Sede A', Servicio: 'UCI' },
    orden: { Consecutivo: 'OT-001' }, ResponsableMtto: { fullName: 'Juan' },
    evidencias, ...extra,
  };
}

const OTS = [{ _id: OT_ID, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }];

function setup({ ots = OTS, reports, captured, equipos = [], customer = { _id: CLIENTE_ID, Razonsocial: 'ACME' } } = {}) {
  Customer.findOne = () => chainable(customer);
  OT.find = (f) => { if (captured) captured.ot = f; return chainable(ots); };
  Report.find = (f) => { if (captured) captured.report = f; return chainable(reports); };
  EquipoItem.find = () => chainable(equipos);
  Repuestos.find = () => chainable([]);
  Tenant.findOne = () => chainable(null);
}

afterEach(() => {
  delete Customer.findOne; delete OT.find; delete Report.find;
  delete EquipoItem.find; delete Repuestos.find; delete Tenant.findOne;
});

const reports = () => [
  report('r1', 'R000001', [
    { _id: EV1, url: 'https://x/1.jpg', nombre: '1.jpg', descripcion: 'd1' },
    { _id: EV2, url: 'https://x/2.jpg', nombre: '2.jpg' },
  ]),
  report('r2', 'R000002', [{ _id: EV3, url: 'https://x/3.jpg', nombre: '3.jpg' }], {
    equipoSnapshot: { ItemText: 'Bomba', Sede: 'Sede A', Servicio: 'UCI' },
  }),
];

describe('generateByOt - fotos', () => {
  it('resolves fotoIds in the requested order with reporte and equipo', async () => {
    setup({ reports: reports() });
    const p = await informeGenerateByOtService.generateByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], fotoIds: [EV3, EV1] }, TENANT_A);
    assert.deepEqual(p.fotos.map(f => f.evidenciaId), [EV3, EV1]);
    assert.equal(p.fotos[0].reporteConsecutivo, 'R000002');
    assert.equal(p.fotos[0].equipoNombre, 'Bomba');
    assert.equal(p.fotos[1].url, 'https://x/1.jpg');
    assert.equal(p.fotos[1].descripcion, 'd1');
  });

  it('foto outside the reports in scope -> 400 INVALID_FOTO_SCOPE', async () => {
    setup({ reports: reports() });
    await assert.rejects(
      informeGenerateByOtService.generateByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], fotoIds: [EV1, EV_OTHER] }, TENANT_A),
      (e) => e.statusCode === 400 && e.code === 'INVALID_FOTO_SCOPE',
    );
  });

  it('fotoId with a non-http(s) url -> INVALID_FOTO_SCOPE', async () => {
    setup({ reports: [report('r1', 'R1', [{ _id: EV1, url: 'javascript:alert(1)', nombre: 'n' }])] });
    await assert.rejects(
      informeGenerateByOtService.generateByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], fotoIds: [EV1] }, TENANT_A),
      (e) => e.code === 'INVALID_FOTO_SCOPE',
    );
  });

  it('report query is always scoped by tenant and cliente', async () => {
    const captured = {};
    setup({ reports: reports(), captured });
    await informeGenerateByOtService.generateByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], fotoIds: [EV1] }, TENANT_A);
    assert.equal(captured.report.tenantId, TENANT_A);
    assert.equal(captured.report.ClienteId, CLIENTE_ID);
  });

  it('without new fields: fotos is [] and no observacionesAdicionalesHtml key (compat)', async () => {
    setup({ reports: reports() });
    const p = await informeGenerateByOtService.generateByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A);
    assert.deepEqual(p.fotos, []);
    assert.equal('observacionesAdicionalesHtml' in p, false);
    assert.equal(p.observacionGeneral, '');
  });
});

describe('generateByOt - observacionesAdicionalesHtml', () => {
  it('returns sanitized html', async () => {
    setup({ reports: reports() });
    const p = await informeGenerateByOtService.generateByOt({
      clienteId: CLIENTE_ID, otIds: [OT_ID],
      observacionesAdicionalesHtml: '<p style="x" onclick="y()"><strong>Hola</strong></p><script>alert(1)</script>',
    }, TENANT_A);
    assert.equal(p.observacionesAdicionalesHtml, '<p><strong>Hola</strong></p>');
  });

  it('omits the field when blank after sanitizing', async () => {
    setup({ reports: reports() });
    const p = await informeGenerateByOtService.generateByOt({
      clienteId: CLIENTE_ID, otIds: [OT_ID], observacionesAdicionalesHtml: '<script>x</script>',
    }, TENANT_A);
    assert.equal('observacionesAdicionalesHtml' in p, false);
  });
});

describe('listEvidenciasByOt', () => {
  it('paginates and reports hasMore', async () => {
    const evs = Array.from({ length: 30 }, (_, i) => ({
      _id: `cccccccccccccccccccc${String(i).padStart(4, '0')}`, url: `https://x/${i}.jpg`, nombre: `${i}.jpg`,
    }));
    setup({ reports: [report('r1', 'R000001', evs)] });
    const p1 = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], page: 1, limit: 24 }, TENANT_A);
    assert.equal(p1.items.length, 24);
    assert.equal(p1.total, 30);
    assert.equal(p1.hasMore, true);
    const p2 = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], page: 2, limit: 24 }, TENANT_A);
    assert.equal(p2.items.length, 6);
    assert.equal(p2.hasMore, false);
  });

  it('filters by reporteId (in-scope reports only) and by search; always tenant/cliente scoped', async () => {
    const captured = {};
    setup({ reports: reports(), captured });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], reporteId: 'r2' }, TENANT_A);
    assert.deepEqual(r.items.map(i => i.evidenciaId), [EV3]);
    assert.equal(captured.report.tenantId, TENANT_A);
    assert.equal(captured.report.ClienteId, CLIENTE_ID);

    const bySearch = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], search: 'bomba' }, TENANT_A);
    assert.deepEqual(bySearch.items.map(i => i.evidenciaId), [EV3]);
    const byConsec = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], search: 'R000001' }, TENANT_A);
    assert.equal(byConsec.total, 2);
  });

  it('items include reporteId (string)', async () => {
    setup({ reports: reports() });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A);
    assert.deepEqual(r.items.map(i => i.reporteId), ['r1', 'r1', 'r2']);
    const p = await informeGenerateByOtService.generateByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], fotoIds: [EV1] }, TENANT_A);
    assert.equal(p.fotos[0].reporteId, 'r1');
  });

  it('reportes lists ALL reports in scope with photos, independent of page/filters', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ _id: `dddddddddddddddddddd${String(i).padStart(4, '0')}`, url: `https://x/${i}.jpg`, nombre: 'n' }));
    setup({ reports: [report('r1', 'R000001', many), report('r2', 'R000002', [{ _id: EV3, url: 'https://x/3.jpg', nombre: 'n' }]), report('r3', 'R000003', [])] });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], reporteId: 'r2', page: 1, limit: 24 }, TENANT_A);
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.reportes.map(x => x.reporteId), ['r1', 'r2']);
    assert.deepEqual(Object.keys(r.reportes[0]).sort(), ['consecutivo', 'equipoNombre', 'reporteId']);
  });

  it('equipo name falls back to the equipo doc (same as generateByOt), also for search', async () => {
    const rep = report('r1', 'R000001', [{ _id: EV1, url: 'https://x/1.jpg', nombre: 'n' }], { equipoSnapshot: {} });
    setup({ reports: [rep], equipos: [{ _id: 'eq-1', item: 'Ventilador', ItemId: { Nombre: 'Otro' } }] });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], search: 'ventil' }, TENANT_A);
    assert.equal(r.items[0].equipoNombre, 'Ventilador');
    assert.equal(r.reportes[0].equipoNombre, 'Ventilador');
  });

  it('orders reports numerically-aware by consecutivo, keeping evidencia order', async () => {
    setup({ reports: [
      report('a', 'R10', [{ _id: EV1, url: 'https://x/1.jpg', nombre: 'n' }]),
      report('b', 'R2', [{ _id: EV2, url: 'https://x/2.jpg', nombre: 'n' }, { _id: EV3, url: 'https://x/3.jpg', nombre: 'n' }]),
    ] });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A);
    assert.deepEqual(r.items.map(i => i.evidenciaId), [EV2, EV3, EV1]);
  });

  it('skips non-http(s) photo urls in the listing', async () => {
    setup({ reports: [report('r1', 'R1', [
      { _id: EV1, url: 'javascript:alert(1)', nombre: 'n' },
      { _id: EV2, url: 'data:image/png;base64,AAAA', nombre: 'n' },
      { _id: EV3, url: 'http://x/ok.jpg', nombre: 'n' },
    ])] });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A);
    assert.deepEqual(r.items.map(i => i.evidenciaId), [EV3]);
  });

  it('unknown customer -> 404 CUSTOMER_NOT_FOUND', async () => {
    setup({ reports: [], customer: null });
    await assert.rejects(
      informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A),
      (e) => e.statusCode === 404 && e.code === 'CUSTOMER_NOT_FOUND',
    );
  });

  it('reporteId outside scope yields an empty list', async () => {
    setup({ reports: [] });
    const r = await informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID], reporteId: 'ffffffffffffffffffffffff' }, TENANT_A);
    assert.deepEqual(r, { items: [], reportes: [], total: 0, page: 1, limit: 24, hasMore: false });
  });

  it('OT outside client/tenant -> 400 INVALID_OT_SCOPE', async () => {
    setup({ ots: [], reports: [] });
    await assert.rejects(
      informeGenerateByOtService.listEvidenciasByOt({ clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A),
      (e) => e.statusCode === 400 && e.code === 'INVALID_OT_SCOPE',
    );
  });
});

describe('buildInformeHtmlByOt - fotos and observaciones adicionales', () => {
  const base = () => ({
    meta: { clienteNombre: 'ACME', tenantNombre: 'T', fechaGeneracion: new Date().toISOString(), otsSeleccionadas: [] },
    kpis: { cumplimientoPct: 100, totalReportes: 0, cumplidos: 0, pendientes: 0, cancelados: 0, correctivos: 0, repuestosInstalados: 0, costoTotal: 0, horasServicio: 0 },
    secciones: [], observacionesReportes: [], observacionGeneral: '',
  });

  it('renders both sections, escaping photo text and keeping sanitized html as-is', () => {
    const html = buildInformeHtmlByOt({
      ...base(),
      fotos: [{ evidenciaId: 'e', url: 'https://x/a.jpg?a=1&b="2"', nombre: '<b>n</b>', descripcion: '', reporteConsecutivo: 'R1', equipoNombre: '<i>Eq</i>' }],
      observacionesAdicionalesHtml: '<p><strong>Clausula</strong></p>',
    });
    assert.ok(html.includes('Evidencia fotográfica'));
    assert.ok(html.includes('Observaciones adicionales'));
    assert.ok(html.includes('<p><strong>Clausula</strong></p>'));
    assert.ok(!html.includes('<i>Eq</i>'));
    assert.ok(!html.includes('<b>n</b>'));
    assert.ok(html.includes('page-break-inside: avoid'));
  });

  it('omits both sections when absent', () => {
    const html = buildInformeHtmlByOt(base());
    assert.ok(!html.includes('Evidencia fotográfica'));
    assert.ok(!html.includes('Observaciones adicionales'));
  });
});
