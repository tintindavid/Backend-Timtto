/**
 * tests/services/informeGenerateByOt.test.js
 *
 * DB-free tests for informeGenerateByOt.service.js — model statics are
 * monkey-patched (same convention as tests/services/equipoItem.duplicate.test.js).
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

const TENANT_A = 'tenant-a';
const CLIENTE_ID = '507f1f77bcf86cd799439001';
const OT_ID = '507f1f77bcf86cd799439010';

function chainable(result) {
  const obj = {
    select() { return obj; },
    populate() { return obj; },
    lean: () => Promise.resolve(result),
  };
  return obj;
}

function baseReport(overrides = {}) {
  return {
    _id: `report-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT_A,
    ClienteId: CLIENTE_ID,
    Equipo: 'equipo-1',
    consecutivo: 'R000001',
    estado: 'Cerrado',
    tipoMtto: 'Preventivo',
    duracion: 45,
    observacion: '',
    equipoSnapshot: { ItemText: 'Monitor', Marca: 'Philips', Sede: 'Sede A', Servicio: 'UCI' },
    orden: { Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta' },
    ResponsableMtto: { fullName: 'Juan Perez' },
    ...overrides,
  };
}

function setupMocks({ customer = { _id: CLIENTE_ID, Razonsocial: 'ACME', Ciudad: 'Bogota' }, ots, reports, equipos = [], repuestos = [] }) {
  Customer.findOne = () => chainable(customer);
  OT.find = () => chainable(ots);
  Report.find = () => chainable(reports);
  EquipoItem.find = () => chainable(equipos);
  Repuestos.find = () => chainable(repuestos);
  Tenant.findOne = () => chainable(null);
}

function cleanupMocks() {
  delete Customer.findOne;
  delete OT.find;
  delete Report.find;
  delete EquipoItem.find;
  delete Repuestos.find;
  delete Tenant.findOne;
}

describe('informeGenerateByOtService.generateByOt — cumplimiento formula', () => {
  afterEach(cleanupMocks);

  it('10 reports: 3 Cerrado, 2 Procesado, 3 Pendiente, 2 Cancelado -> 62.5%', async () => {
    const reports = [
      ...Array.from({ length: 3 }, () => baseReport({ estado: 'Cerrado' })),
      ...Array.from({ length: 2 }, () => baseReport({ estado: 'Procesado' })),
      ...Array.from({ length: 3 }, () => baseReport({ estado: 'Pendiente' })),
      ...Array.from({ length: 2 }, () => baseReport({ estado: 'Cancelado' })),
    ];
    setupMocks({ ots: [{ _id: OT_ID, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }], reports });

    const payload = await informeGenerateByOtService.generateByOt(
      { clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A, {}, {},
    );

    assert.equal(payload.kpis.totalReportes, 8); // excludes cancelados
    assert.equal(payload.kpis.cancelados, 2);
    assert.equal(payload.kpis.cumplidos, 5);
    assert.equal(payload.kpis.pendientes, 3);
    assert.equal(payload.kpis.cumplimientoPct, 62.5);
  });

  it('all reports canceled -> denominator zero renders em-dash, no throw', async () => {
    const reports = Array.from({ length: 4 }, () => baseReport({ estado: 'Cancelado' }));
    setupMocks({ ots: [{ _id: OT_ID, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }], reports });

    const payload = await informeGenerateByOtService.generateByOt(
      { clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A, {}, {},
    );

    assert.equal(payload.kpis.cumplimientoPct, null);
  });

  it('all reports compliant -> 100%', async () => {
    const reports = Array.from({ length: 5 }, () => baseReport({ estado: 'Cerrado' }));
    setupMocks({ ots: [{ _id: OT_ID, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }], reports });

    const payload = await informeGenerateByOtService.generateByOt(
      { clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A, {}, {},
    );

    assert.equal(payload.kpis.cumplimientoPct, 100);
  });
});

describe('informeGenerateByOtService.generateByOt — Sede/Servicio grouping', () => {
  afterEach(cleanupMocks);

  it('sections are ordered alphabetically by sede then servicio, with per-section %', async () => {
    const reports = [
      baseReport({ estado: 'Cerrado', equipoSnapshot: { Sede: 'Sede B', Servicio: 'Urgencias' } }),
      baseReport({ estado: 'Pendiente', equipoSnapshot: { Sede: 'Sede B', Servicio: 'Urgencias' } }),
      baseReport({ estado: 'Cerrado', equipoSnapshot: { Sede: 'Sede A', Servicio: 'UCI' } }),
      baseReport({ estado: 'Cerrado', equipoSnapshot: { Sede: 'Sede A', Servicio: 'Cirugia' } }),
    ];
    setupMocks({ ots: [{ _id: OT_ID, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }], reports });

    const payload = await informeGenerateByOtService.generateByOt(
      { clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A, {}, {},
    );

    assert.equal(payload.secciones.length, 3);
    assert.deepEqual(
      payload.secciones.map(s => `${s.sede}/${s.servicio}`),
      ['Sede A/Cirugia', 'Sede A/UCI', 'Sede B/Urgencias'],
    );

    const urgencias = payload.secciones.find(s => s.servicio === 'Urgencias');
    assert.equal(urgencias.totalReportes, 2);
    assert.equal(urgencias.cumplimientoPct, 50);
  });
});

describe('informeGenerateByOtService.generateByOt — observacionesReportes', () => {
  afterEach(cleanupMocks);

  it('skips empty observaciones, formats non-empty ones with fallback estadoOperativo', async () => {
    const reports = [
      baseReport({ observacion: '', consecutivo: 'R000001' }),
      baseReport({
        observacion: 'Se recomienda cambio de pera',
        consecutivo: 'R000002',
        EstadoOperativo: null,
        Equipo: 'equipo-2',
      }),
    ];
    const equipos = [{ _id: 'equipo-2', EstadoOperativo: 'Fuera de Servicio' }];
    setupMocks({ ots: [{ _id: OT_ID, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }], reports, equipos });

    const payload = await informeGenerateByOtService.generateByOt(
      { clienteId: CLIENTE_ID, otIds: [OT_ID] }, TENANT_A, {}, {},
    );

    assert.equal(payload.observacionesReportes.length, 1);
    assert.equal(payload.observacionesReportes[0].consecutivo, 'R000002');
    assert.equal(payload.observacionesReportes[0].estadoOperativo, 'Fuera de Servicio');
    assert.equal(payload.observacionesReportes[0].observacion, 'Se recomienda cambio de pera');
  });
});
