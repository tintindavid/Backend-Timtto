/**
 * Dashboard indicators (change: dashboard-por-tenant-indicadores, tasks 3.x). DB-free: models are patched with the
 * in-memory fake of tests/helpers/dashboardFakeDb.js. Two tenants hold data and every query must stay in one.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { installFakeDb } from '../helpers/dashboardFakeDb.js';
import { buildDashboardContext } from '../../src/utils/dashboardContext.util.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { User } from '../../src/models/user.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { dashboardCumplimientoService as cumplimientoSvc } from '../../src/services/dashboardCumplimiento.service.js';
import { dashboardActividadService as actividadSvc } from '../../src/services/dashboardActividad.service.js';
import { dashboardTiemposService as tiemposSvc, bucketOf, medianOfSorted, percentileOfSorted, TIEMPOS_MAX_REPORTES } from '../../src/services/dashboardTiempos.service.js';
import { dashboardOperativosService as operativosSvc } from '../../src/services/dashboardOperativos.service.js';
import { MAX_EQUIPO_IDS, notApplied } from '../../src/services/dashboard.common.js';

const id = () => new mongoose.Types.ObjectId();
const C1 = id(); const C2 = id(); const CB = id();
const S1 = id(); const S2 = id(); const SV1 = id();
const U1 = id(); const U2 = id(); const UB = id();
const [E1, E2, E3, E4, EB1, EB2] = [id(), id(), id(), id(), id(), id()];
const [OT1, OT2, OT3, OTB] = [id(), id(), id(), id()];
const NOW = new Date('2026-11-13T15:00:00Z');

const equipo = (o) => ({ isDeleted: false, mesesMtto: [], mesesMttoRealizados: [], EstadoOperativo: 'Operativo', UltimoMtto: null, ...o });
const report = (o) => ({ isDeleted: false, tipoMtto: 'Preventivo', estado: 'Cerrado', FechaCreacion: new Date('2026-11-02T12:00:00Z'), ...o });

function buildData() {
  return {
    Customer: { Model: Customer, rows: [
      { _id: C1, tenantId: 'tenant-a', Razonsocial: 'Acme', isDeleted: false },
      { _id: C2, tenantId: 'tenant-a', Razonsocial: 'Beta', isDeleted: false },
      { _id: CB, tenantId: 'tenant-b', Razonsocial: 'OtherTenant', isDeleted: false },
    ] },
    User: { Model: User, rows: [
      { _id: U1, tenantId: 'tenant-a', fullName: 'Ana A' },
      { _id: U2, tenantId: 'tenant-a', fullName: 'Beto B' },
      { _id: UB, tenantId: 'tenant-b', fullName: 'Bruno (otro tenant)' },
    ] },
    EquipoItem: { Model: EquipoItem, rows: [
      equipo({ _id: E1, tenantId: 'tenant-a', ClienteId: C1, SedeId: S1, item: 'Monitor', Serie: 'S1', mesesMtto: ['nov', 'mar'],
        mesesMttoRealizados: [{ fecha: new Date('2026-11-05T15:00:00Z'), mes: 'nov' }], UltimoMtto: new Date('2026-11-05T15:00:00Z') }),
      equipo({ _id: E2, tenantId: 'tenant-a', ClienteId: C1, SedeId: S1, item: 'Monitor', Serie: 'S2', mesesMtto: ['nov'] }),
      equipo({ _id: E3, tenantId: 'tenant-a', ClienteId: C1, SedeId: S2, item: 'Bomba', Serie: 'S3', mesesMtto: ['oct'], EstadoOperativo: 'Fuera de Servicio',
        mesesMttoRealizados: [{ fecha: new Date('2026-11-02T15:00:00Z'), mes: 'nov' }], UltimoMtto: new Date('2025-01-01T00:00:00Z') }),
      // 2026-12-01T04:00Z is Nov 30 23:00 in Bogota: still November
      equipo({ _id: E4, tenantId: 'tenant-a', ClienteId: C2, SedeId: S2, item: 'Cama', Serie: 'S4', mesesMtto: ['nov'],
        mesesMttoRealizados: [{ fecha: new Date('2026-12-01T04:00:00Z'), mes: 'nov' }], UltimoMtto: new Date('2026-11-30T00:00:00Z') }),
      equipo({ _id: EB1, tenantId: 'tenant-b', ClienteId: CB, mesesMtto: ['nov'], item: 'TenantB', EstadoOperativo: 'En Reparacion' }),
      equipo({ _id: EB2, tenantId: 'tenant-b', ClienteId: CB, mesesMtto: ['nov'], item: 'TenantB', EstadoOperativo: 'En Reparacion' }),
    ] },
    OT: { Model: OT, rows: [
      { _id: OT1, tenantId: 'tenant-a', isDeleted: false, Consecutivo: 'OT-1', ClienteId: C1, EstadoOt: 'En Progreso', TipoServicio: 'Preventivo', FechaCreacion: new Date('2026-11-04T00:00:00Z') },
      { _id: OT2, tenantId: 'tenant-a', isDeleted: false, Consecutivo: 'OT-2', ClienteId: C1, EstadoOt: 'Completado', TipoServicio: 'Correctivo', FechaCreacion: new Date('2026-11-01T14:24:00Z') },
      { _id: OT3, tenantId: 'tenant-a', isDeleted: false, Consecutivo: 'OT-3', ClienteId: C2, EstadoOt: 'Pendiente', TipoServicio: 'Preventivo', FechaCreacion: new Date('2026-09-01T00:00:00Z') },
      { _id: OTB, tenantId: 'tenant-b', isDeleted: false, Consecutivo: 'OT-B', ClienteId: CB, EstadoOt: 'Pendiente', TipoServicio: 'Preventivo', FechaCreacion: new Date('2026-08-01T00:00:00Z') },
    ] },
    Report: { Model: Report, rows: [
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, orden: OT1, ResponsableMtto: U1, procesadoPor: { userId: U1, snapshotName: 'Ana' },
        fechaProcesado: new Date('2026-11-05T10:00:00Z'), equipoSnapshot: { ItemText: 'Monitor' } }),
      // legacy: no procesadoPor -> attributed to ResponsableMtto
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E2, orden: OT1, ResponsableMtto: U2, estado: 'Procesado',
        fechaProcesado: new Date('2026-11-10T00:00:00Z'), equipoSnapshot: { ItemText: 'Monitor' } }),
      // no snapshot: item type falls back to the equipment item
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E3, orden: OT2, ResponsableMtto: U1, tipoMtto: 'Correctivo', procesadoPor: { userId: U1, snapshotName: 'Ana' },
        fechaProcesado: new Date('2026-11-20T00:00:00Z') }),
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, orden: OT1, ResponsableMtto: U1, estado: 'Pendiente' }),
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E2, orden: OT1, ResponsableMtto: U1, estado: 'Cancelado', fechaCancelacion: new Date('2026-11-08T12:00:00Z') }),
      report({ _id: id(), tenantId: 'tenant-b', ClienteId: CB, Equipo: EB1, orden: OTB, ResponsableMtto: UB, procesadoPor: { userId: UB, snapshotName: 'Bruno' },
        fechaProcesado: new Date('2026-11-06T00:00:00Z'), equipoSnapshot: { ItemText: 'TenantB' } }),
      report({ _id: id(), tenantId: 'tenant-b', ClienteId: CB, Equipo: EB1, orden: OTB, ResponsableMtto: UB, estado: 'Cancelado' }),
    ] },
    Ticket: { Model: Ticket, rows: [
      { tenantId: 'tenant-a', isDeleted: false, status: 'pendiente', ClienteId: C1, sedeId: S1, servicioId: SV1 },
      { tenantId: 'tenant-a', isDeleted: false, status: 'en_proceso', ClienteId: C1, sedeId: S2, servicioId: SV1 },
      { tenantId: 'tenant-a', isDeleted: false, status: 'cerrado', ClienteId: C1 },
      ...Array.from({ length: 5 }, () => ({ tenantId: 'tenant-b', isDeleted: false, status: 'pendiente', ClienteId: CB })),
    ] },
    Requisicion: { Model: Requisicion, rows: [
      { tenantId: 'tenant-a', isDeleted: false, estado: 'Enviada', creadaPor: U1, solicitanteId: U1 },
      { tenantId: 'tenant-a', isDeleted: false, estado: 'En_Aprobacion', creadaPor: U2, solicitanteId: U2 },
      { tenantId: 'tenant-a', isDeleted: false, estado: 'Borrador' },
      ...Array.from({ length: 4 }, () => ({ tenantId: 'tenant-b', isDeleted: false, estado: 'Enviada' })),
    ] },
  };
}

const ALL_CAPS = { executesServices: true, managesCustomers: true, usesQrs: true, usesRequisiciones: true, registersExternal: false };
const ALL_PERMS = [PERMISSIONS.TICKETS_READ, PERMISSIONS.REQUISICIONES_READ, PERMISSIONS.REQUISICIONES_REPORTS];

function ctxFor({ tenantId = 'tenant-a', caps = ALL_CAPS, perms = ALL_PERMS, userId = String(U1), query = {}, organizationCustomerId, role = 'admin' } = {}) {
  return buildDashboardContext({
    tenantId,
    tenant: { tenantId, capabilities: caps, organizationCustomerId },
    user: { userId, role, permissions: perms },
    query,
  }, NOW);
}

let db;
beforeEach(() => { db = installFakeDb(buildData()); });
afterEach(() => { db.restore(); });

/** Every recorded query (and aggregation first stage) must carry the tenant under test. */
function assertTenantOnly(tenantId) {
  assert.ok(db.calls.length > 0, 'the service queried the database');
  for (const call of db.calls) {
    assert.equal(call.filter?.tenantId, tenantId, `${call.model}.${call.op} must be scoped to ${tenantId}`);
  }
}

describe('dashboard cumplimiento', () => {
  it('programmed/completed/percentage/not-programmed on the schedule, Bogota boundary included', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor());
    assert.deepEqual(r.periodo, { desde: '2026-11-01', hasta: '2026-11-30', etiqueta: 'Noviembre 2026' });
    assert.equal(r.programadas, 3);          // e1, e2, e4 (nov)
    assert.equal(r.realizadas, 2);           // e1, e4 (Nov 30 23:00 Bogota)
    assert.equal(r.porcentaje, 66.7);
    assert.equal(r.noProgramadasRealizadas, 1); // e3 done in nov, scheduled in oct
    assert.deepEqual(r.filtrosNoAplicados, []);
    assertTenantOnly('tenant-a');
  });

  it('breakdown by customer and by type (by-OT classification)', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor());
    const acme = r.porCliente.find((c) => c.clienteId === String(C1));
    assert.deepEqual(acme, { clienteId: String(C1), cliente: 'Acme', programadas: 2, realizadas: 1, porcentaje: 50 });
    assert.equal(r.porCliente.some((c) => c.cliente === 'OtherTenant'), false);
    assert.deepEqual(r.porTipo.find((t) => t.tipo === 'Preventivo'), { tipo: 'Preventivo', programados: 4, cumplidos: 2, cancelados: 1, pendientes: 1 });
    assert.deepEqual(r.porTipo.find((t) => t.tipo === 'Correctivo'), { tipo: 'Correctivo', programados: 1, cumplidos: 1, cancelados: 0, pendientes: 0 });
  });

  it('trend: 6 year-months, oldest first, ending at the period end', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor());
    assert.deepEqual(r.tendencia.map((t) => t.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    assert.deepEqual(r.tendencia[5], { mes: '2026-11', etiqueta: 'Nov 2026', programadas: 3, realizadas: 2, porcentaje: 66.7 });
    assert.deepEqual(r.tendencia[4], { mes: '2026-10', etiqueta: 'Oct 2026', programadas: 1, realizadas: 0, porcentaje: 0 });
    assert.equal(r.tendencia[0].porcentaje, 0); // nothing scheduled: no division error
  });

  it('declares tipoMtto/tecnicoId as not applied and still honours customer and site filters', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor({ query: { tipoMtto: 'Correctivo', tecnicoId: String(U1), sedeId: String(S1) } }));
    assert.deepEqual(r.filtrosNoAplicados, ['tipoMtto', 'tecnicoId']);
    assert.equal(r.programadas, 2); // e1, e2 are in S1
    const byCliente = await cumplimientoSvc.cumplimiento(ctxFor({ query: { clienteId: String(C2) } }));
    assert.equal(byCliente.programadas, 1);
    assert.equal(byCliente.realizadas, 1);
  });

  it('an empty period has 0% and no division errors', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor({ query: { periodo: 'rango', desde: '2020-01-01', hasta: '2020-01-31' } }));
    assert.equal(r.programadas, 0);
    assert.equal(r.porcentaje, 0);
  });

  it('a client-type tenant (no executesServices) keeps the schedule but has no report breakdown', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor({ caps: { executesServices: false, registersExternal: true } }));
    assert.equal(r.programadas, 3);
    assert.deepEqual(r.porTipo, []);
  });

  it('isolation: tenant B sees only its own figures', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor({ tenantId: 'tenant-b' }));
    assert.equal(r.programadas, 2);
    assert.equal(r.realizadas, 0);
    assert.deepEqual(r.porCliente.map((c) => c.cliente), ['OtherTenant']);
    assertTenantOnly('tenant-b');
  });
});

describe('dashboard equipos-periodo', () => {
  it('current, previous, overdue and cancelled figures with variation', async () => {
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor());
    assert.deepEqual(r.actual, { programados: 3, realizados: 2, pendientes: 1, vencidos: 2, cancelados: 1 });
    // October: only e3 scheduled (not completed), e1's march is the only overdue one
    assert.deepEqual(r.anterior, { programados: 1, realizados: 0, pendientes: 1, vencidos: 1, cancelados: 0 });
    assert.deepEqual(r.variacion.programados, { absoluta: 2, porcentaje: 200 });
    assert.deepEqual(r.variacion.realizados, { absoluta: 2, porcentaje: null }); // previous is 0
    assertTenantOnly('tenant-a');
  });

  it('declares tipoMtto and tecnicoId as not applied', async () => {
    assert.deepEqual((await cumplimientoSvc.equiposPeriodo(ctxFor())).filtrosNoAplicados, []);
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor({ query: { tipoMtto: 'Correctivo', tecnicoId: String(U1), sedeId: String(S1) } }));
    assert.deepEqual(r.filtrosNoAplicados, ['tipoMtto', 'tecnicoId']);
  });

  it('a range that is not made of whole months measures the calendar months it touches; previous = same number of months before', async () => {
    // 10-20 Nov counts all of November and the previous period is October
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor({ query: { periodo: 'rango', desde: '2026-11-10', hasta: '2026-11-20' } }));
    assert.deepEqual(r.actual, { programados: 3, realizados: 2, pendientes: 1, vencidos: 2, cancelados: 1 });
    assert.deepEqual(r.anterior, { programados: 1, realizados: 0, pendientes: 1, vencidos: 1, cancelados: 0 });
    assert.deepEqual(r.periodo, { desde: '2026-11-10', hasta: '2026-11-20', etiqueta: '2026-11-10 a 2026-11-20' });
  });

  it('a range across the year end (Bogota) uses 2 months and the 2 months before, without overlap', async () => {
    db.restore();
    const data = buildData();
    data.EquipoItem.rows = [
      equipo({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, mesesMtto: ['dic', 'ene'],
        mesesMttoRealizados: [{ fecha: new Date('2027-01-01T04:00:00Z') }] }), // Dec 31 23:00 Bogota: December
      equipo({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, mesesMtto: ['oct', 'nov'],
        mesesMttoRealizados: [{ fecha: new Date('2026-10-10T15:00:00Z') }] }),
    ];
    db = installFakeDb(data);
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor({ query: { periodo: 'rango', desde: '2026-12-20', hasta: '2027-01-05' } }));
    assert.deepEqual([r.actual.programados, r.actual.realizados], [2, 1]);
    assert.deepEqual([r.anterior.programados, r.anterior.realizados], [2, 1]);
  });

  it('variation of 8 vs 10 completed is -2 / -20%', async () => {
    const mk = (n, key) => Array.from({ length: n }, () => equipo({ tenantId: 'tenant-a', ClienteId: C1, mesesMtto: ['oct', 'nov'],
      mesesMttoRealizados: [{ fecha: new Date(key), mes: 'x' }] }));
    db.restore();
    const data = buildData();
    data.EquipoItem.rows = [...mk(8, '2026-11-05T15:00:00Z'), ...mk(2, '2026-10-05T15:00:00Z'), ...mk(8, '2026-10-06T15:00:00Z')];
    db = installFakeDb(data);
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor());
    assert.equal(r.actual.realizados, 8);
    assert.equal(r.anterior.realizados, 10);
    assert.deepEqual(r.variacion.realizados, { absoluta: -2, porcentaje: -20 });
  });

  it('client-type tenant: cancelled is 0 (no reports)', async () => {
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor({ caps: { executesServices: false } }));
    assert.equal(r.actual.cancelados, 0);
    assert.equal(r.actual.programados, 3);
  });

  it('isolation: tenant B', async () => {
    const r = await cumplimientoSvc.equiposPeriodo(ctxFor({ tenantId: 'tenant-b' }));
    assert.equal(r.actual.programados, 2);
    assert.equal(r.actual.cancelados, 1);
    assertTenantOnly('tenant-b');
  });
});

describe('dashboard mis-cifras', () => {
  it('counts only the session user: open, done, cancelled and average time', async () => {
    const r = await actividadSvc.misCifras(ctxFor({ userId: String(U1) }));
    assert.deepEqual({ ...r, periodo: undefined }, { periodo: undefined, disponible: true, abiertos: 1, realizados: 2, cancelados: 1, tiempoPromedioDias: 9.9, truncado: false });
    assertTenantOnly('tenant-a');
  });

  it('the user id comes from the session, never from the query (tecnicoId is replaced)', async () => {
    const r = await actividadSvc.misCifras(ctxFor({ userId: String(U2), query: { tecnicoId: String(U1) } }));
    assert.equal(r.realizados, 1); // U2: only the legacy report
    assert.equal(r.abiertos, 0);
  });

  it('a user without activity gets zeros and null time', async () => {
    const r = await actividadSvc.misCifras(ctxFor({ userId: String(id()) }));
    assert.deepEqual([r.abiertos, r.realizados, r.cancelados, r.tiempoPromedioDias], [0, 0, 0, null]);
  });

  it('tenant B user does not see tenant A reports', async () => {
    const r = await actividadSvc.misCifras(ctxFor({ tenantId: 'tenant-b', userId: String(U1) }));
    assert.deepEqual([r.abiertos, r.realizados, r.cancelados], [0, 0, 0]);
    assertTenantOnly('tenant-b');
  });

  it('is unavailable without executesServices', async () => {
    const r = await actividadSvc.misCifras(ctxFor({ caps: { executesServices: false } }));
    assert.equal(r.disponible, false);
    assert.equal(db.calls.length, 0);
  });
});

describe('dashboard ranking', () => {
  it('orders by completed reports and attributes legacy reports to ResponsableMtto', async () => {
    const r = await actividadSvc.ranking(ctxFor());
    assert.deepEqual(r.items, [
      { userId: String(U1), nombre: 'Ana', realizados: 2 },
      { userId: String(U2), nombre: 'Beto B', realizados: 1 },
    ]);
    assert.equal(JSON.stringify(r).includes('Bruno'), false);
    assertTenantOnly('tenant-a');
  });

  it('exposes only id, display name and count, capped to 10', async () => {
    db.restore();
    const data = buildData();
    for (let i = 0; i < 12; i += 1) {
      data.Report.rows.push(report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, procesadoPor: { userId: id(), snapshotName: `U${i}` }, fechaProcesado: new Date('2026-11-12T00:00:00Z') }));
    }
    db = installFakeDb(data);
    const r = await actividadSvc.ranking(ctxFor());
    assert.equal(r.items.length, 10);
    assert.deepEqual(Object.keys(r.items[0]).sort(), ['nombre', 'realizados', 'userId']);
  });

  it('site filter resolves through the equipment', async () => {
    const r = await actividadSvc.ranking(ctxFor({ query: { sedeId: String(S2) } }));
    assert.deepEqual(r.items.map((i) => [i.nombre, i.realizados]), [['Ana', 1]]); // only e3's report
    assert.ok(db.calls.some((c) => c.model === 'EquipoItem' && c.op === 'find' && c.filter.SedeId));
  });

  it('over 20000 equipment the site filter is not applied and the response declares it', async () => {
    db.restore();
    const data = buildData();
    data.EquipoItem.rows = Array.from({ length: MAX_EQUIPO_IDS + 1 }, () => equipo({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, SedeId: S1 }));
    db = installFakeDb(data);
    const ctx = ctxFor({ query: { sedeId: String(S1) } });
    const r = await actividadSvc.ranking(ctx);
    assert.equal(r.items.length, 2); // every done report, the filter was not applied
    assert.deepEqual(notApplied(ctx, []), ['sedeId']);
    const eq = await cumplimientoSvc.equiposPeriodo(ctx); // the equipment filter itself still applies there
    assert.equal(eq.filtrosNoAplicados.includes('sedeId'), true);
  });

  it('isolation and capability', async () => {
    const b = await actividadSvc.ranking(ctxFor({ tenantId: 'tenant-b' }));
    assert.deepEqual(b.items, [{ userId: String(UB), nombre: 'Bruno', realizados: 1 }]);
    const none = await actividadSvc.ranking(ctxFor({ caps: { executesServices: false } }));
    assert.equal(none.disponible, false);
  });
});

describe('dashboard items', () => {
  it('groups done reports by item type with the equipment fallback; cancelled are excluded', async () => {
    const r = await actividadSvc.items(ctxFor());
    assert.equal(r.total, 3);
    assert.deepEqual(r.items, [{ tipo: 'Monitor', cantidad: 2 }, { tipo: 'Bomba', cantidad: 1 }]);
    assertTenantOnly('tenant-a');
  });

  it('top 10 plus Otros', async () => {
    db.restore();
    const data = buildData();
    data.Report.rows = Array.from({ length: 14 }, (_, i) => report({
      _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, procesadoPor: { userId: U1 },
      fechaProcesado: new Date('2026-11-12T00:00:00Z'), equipoSnapshot: { ItemText: `Tipo ${String(i).padStart(2, '0')}` },
    }));
    db = installFakeDb(data);
    const r = await actividadSvc.items(ctxFor());
    assert.equal(r.items.length, 11);
    assert.deepEqual(r.items[10], { tipo: 'Otros', cantidad: 4 });
    assert.equal(r.total, 14);
  });

  it('isolation', async () => {
    const b = await actividadSvc.items(ctxFor({ tenantId: 'tenant-b' }));
    assert.deepEqual(b.items, [{ tipo: 'TenantB', cantidad: 1 }]);
    assertTenantOnly('tenant-b');
  });
});

describe('dashboard tiempos', () => {
  it('average, median, p90, histogram and slowest work orders', async () => {
    const r = await tiemposSvc.tiempos(ctxFor());
    assert.equal(r.disponible, true);
    assert.equal(r.total, 3);
    assert.equal(r.promedioDias, 8.6);
    assert.equal(r.medianaDias, 6);
    assert.equal(r.p90Dias, 18.4);
    assert.deepEqual(r.histograma, [
      { rango: '0-1', cantidad: 1 }, { rango: '2-3', cantidad: 0 }, { rango: '4-7', cantidad: 1 },
      { rango: '8-15', cantidad: 0 }, { rango: '16-30', cantidad: 1 }, { rango: '>30', cantidad: 0 },
    ]);
    assert.deepEqual(r.masLentas, [
      { otId: String(OT2), consecutivo: 'OT-2', promedioDias: 18.4, reportes: 1 },
      { otId: String(OT1), consecutivo: 'OT-1', promedioDias: 3.7, reportes: 2 },
    ]);
    assert.equal(r.truncado, false);
    assertTenantOnly('tenant-a');
  });

  it('tipoMtto filter measures only that type', async () => {
    const r = await tiemposSvc.tiempos(ctxFor({ query: { tipoMtto: 'Correctivo' } }));
    assert.equal(r.total, 1);
    assert.equal(r.promedioDias, 18.4);
  });

  it('no data gives nulls and an all-zero histogram', async () => {
    const r = await tiemposSvc.tiempos(ctxFor({ query: { periodo: 'rango', desde: '2020-01-01', hasta: '2020-01-31' } }));
    assert.equal(r.total, 0);
    assert.deepEqual([r.promedioDias, r.medianaDias, r.p90Dias], [null, null, null]);
    assert.equal(r.histograma.length, 6);
    assert.deepEqual(r.masLentas, []);
  });

  it('discards negative differences and reports without dates', async () => {
    db.restore();
    const data = buildData();
    data.Report.rows = [
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, orden: OT1, procesadoPor: { userId: U1 }, fechaProcesado: new Date('2026-11-03T00:00:00Z') }), // before the OT: negative
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, orden: OT1, procesadoPor: { userId: U1 }, fechaProcesado: new Date('2026-11-06T00:00:00Z') }), // 2 days
      report({ _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, procesadoPor: { userId: U1 }, fechaProcesado: new Date('2026-11-06T00:00:00Z') }), // no orden
    ];
    db = installFakeDb(data);
    const r = await tiemposSvc.tiempos(ctxFor());
    assert.equal(r.total, 1);
    assert.equal(r.promedioDias, 2);
  });

  it('caps at 5000 reports and flags truncado', async () => {
    db.restore();
    const data = buildData();
    data.Report.rows = Array.from({ length: TIEMPOS_MAX_REPORTES + 1 }, () => report({
      _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, orden: OT1, procesadoPor: { userId: U1 }, fechaProcesado: new Date('2026-11-06T00:00:00Z'),
    }));
    db = installFakeDb(data);
    const r = await tiemposSvc.tiempos(ctxFor());
    assert.equal(r.truncado, true);
    assert.equal(r.total, TIEMPOS_MAX_REPORTES);
  });

  it('statistics helpers: 1, 3, 8 -> average 4, median 3, buckets 0-1 / 2-3 / 8-15', () => {
    assert.equal(medianOfSorted([1, 3, 8]), 3);
    assert.equal(medianOfSorted([1, 3]), 2);
    assert.equal(percentileOfSorted([1, 3, 8], 0.9), 8);
    assert.deepEqual([1, 3, 8, 31, 1.5, 16].map(bucketOf), ['0-1', '2-3', '8-15', '>30', '0-1', '16-30']);
  });

  it('histogram buckets use the unrounded days: <2, <4, <8, <16, <=30, >30', () => {
    assert.deepEqual(
      [0, 1.99, 1.96, 2, 3.99, 4, 7.99, 8, 15.99, 16, 30, 30.01].map(bucketOf),
      ['0-1', '0-1', '0-1', '2-3', '2-3', '4-7', '4-7', '8-15', '8-15', '16-30', '16-30', '>30'],
    );
  });

  it('mis-cifras flags truncado when the average was cut at 5000 reports', async () => {
    db.restore();
    const data = buildData();
    data.Report.rows = Array.from({ length: TIEMPOS_MAX_REPORTES + 1 }, () => report({
      _id: id(), tenantId: 'tenant-a', ClienteId: C1, Equipo: E1, orden: OT1, ResponsableMtto: U1, procesadoPor: { userId: U1 }, fechaProcesado: new Date('2026-11-06T00:00:00Z'),
    }));
    db = installFakeDb(data);
    const r = await actividadSvc.misCifras(ctxFor({ userId: String(U1) }));
    assert.equal(r.truncado, true);
  });

  it('isolation and capability', async () => {
    const b = await tiemposSvc.tiempos(ctxFor({ tenantId: 'tenant-b' }));
    assert.equal(b.total, 1);
    assert.equal(b.masLentas[0].consecutivo, 'OT-B');
    assertTenantOnly('tenant-b');
    const none = await tiemposSvc.tiempos(ctxFor({ caps: { executesServices: false } }));
    assert.equal(none.disponible, false);
  });
});

describe('dashboard operativos', () => {
  it('work orders by state in the period, preventive vs corrective, equipment by operating state, tickets, requisitions', async () => {
    const r = await operativosSvc.operativos(ctxFor());
    assert.deepEqual(r.otsPorEstado, { disponible: true, items: [{ estado: 'Completado', cantidad: 1 }, { estado: 'En Progreso', cantidad: 1 }] });
    assert.deepEqual(r.preventivoVsCorrectivo, { disponible: true, preventivo: 3, correctivo: 1, otros: 0 });
    assert.deepEqual(r.equiposPorEstadoOperativo, { disponible: true, items: [{ estado: 'Operativo', cantidad: 3 }, { estado: 'Fuera de Servicio', cantidad: 1 }] });
    assert.deepEqual(r.ticketsAbiertos, { disponible: true, cantidad: 2 });
    assert.deepEqual(r.requisicionesPendientes, { disponible: true, cantidad: 2 });
    assertTenantOnly('tenant-a');
  });

  it('module off or missing permission gives disponible:false with no query', async () => {
    const noReq = await operativosSvc.operativos(ctxFor({ caps: { ...ALL_CAPS, usesRequisiciones: false } }));
    assert.deepEqual(noReq.requisicionesPendientes, { disponible: false });
    assert.equal(noReq.ticketsAbiertos.disponible, true);
    const noPerm = await operativosSvc.operativos(ctxFor({ perms: [PERMISSIONS.REQUISICIONES_READ] }));
    assert.deepEqual(noPerm.ticketsAbiertos, { disponible: false });
    assert.equal(noPerm.requisicionesPendientes.disponible, true);
    const noQrs = await operativosSvc.operativos(ctxFor({ caps: { ...ALL_CAPS, usesQrs: false } }));
    assert.deepEqual(noQrs.ticketsAbiertos, { disponible: false });
  });

  it('requisitions: only requisiciones:read counts the user own view; requisiciones:reports counts the tenant', async () => {
    const own = await operativosSvc.operativos(ctxFor({ perms: [PERMISSIONS.REQUISICIONES_READ], userId: String(U1) }));
    assert.deepEqual(own.requisicionesPendientes, { disponible: true, cantidad: 1 }); // U1 created one of the two pending
    const other = await operativosSvc.operativos(ctxFor({ perms: [PERMISSIONS.REQUISICIONES_READ], userId: String(U2) }));
    assert.equal(other.requisicionesPendientes.cantidad, 1);
    const nobody = await operativosSvc.operativos(ctxFor({ perms: [PERMISSIONS.REQUISICIONES_READ], userId: String(id()) }));
    assert.equal(nobody.requisicionesPendientes.cantidad, 0);
    const all = await operativosSvc.operativos(ctxFor({ perms: [PERMISSIONS.REQUISICIONES_READ, PERMISSIONS.REQUISICIONES_REPORTS] }));
    assert.equal(all.requisicionesPendientes.cantidad, 2);
    const sa = await operativosSvc.operativos(ctxFor({ role: 'superadmin', perms: [] }));
    assert.equal(sa.requisicionesPendientes.cantidad, 2);
  });

  it('tickets apply sede and service filters; preventivo/correctivo applies the technician; OTs by state apply type', async () => {
    const bySede = await operativosSvc.operativos(ctxFor({ query: { sedeId: String(S1) } }));
    assert.equal(bySede.ticketsAbiertos.cantidad, 1);
    const bySvc = await operativosSvc.operativos(ctxFor({ query: { servicioId: String(SV1) } }));
    assert.equal(bySvc.ticketsAbiertos.cantidad, 2);
    const byTec = await operativosSvc.operativos(ctxFor({ query: { tecnicoId: String(U2) } }));
    assert.deepEqual(byTec.preventivoVsCorrectivo, { disponible: true, preventivo: 1, correctivo: 0, otros: 0 }); // U2 is ResponsableMtto of one report
    const byU1 = await operativosSvc.operativos(ctxFor({ query: { tecnicoId: String(U1) } }));
    assert.deepEqual(byU1.preventivoVsCorrectivo, { disponible: true, preventivo: 2, correctivo: 1, otros: 0 }); // cancelled excluded
    const byTipo = await operativosSvc.operativos(ctxFor({ query: { tipoMtto: 'Correctivo' } }));
    assert.deepEqual(byTipo.otsPorEstado.items, [{ estado: 'Completado', cantidad: 1 }]);
  });

  it('filtrosNoAplicados: the union of what the available sections ignore, only for filters that were sent', async () => {
    const none = await operativosSvc.operativos(ctxFor());
    assert.deepEqual(none.filtrosNoAplicados, []);
    const all = await operativosSvc.operativos(ctxFor({ query: { clienteId: String(C1), sedeId: String(S1), servicioId: String(SV1), tipoMtto: 'Preventivo', tecnicoId: String(U1) } }));
    assert.deepEqual([...all.filtrosNoAplicados].sort(), ['clienteId', 'sedeId', 'servicioId', 'tecnicoId', 'tipoMtto']);
    // without requisitions every remaining section applies customer and site except the OTs by state (site)
    const noReq = await operativosSvc.operativos(ctxFor({ caps: { ...ALL_CAPS, usesRequisiciones: false }, query: { clienteId: String(C1), sedeId: String(S1) } }));
    assert.deepEqual(noReq.filtrosNoAplicados, ['sedeId']);
  });

  it('superadmin (view as) bypasses the permission check like authorize()', async () => {
    const r = await operativosSvc.operativos(ctxFor({ role: 'superadmin', perms: [] }));
    assert.equal(r.ticketsAbiertos.disponible, true);
  });

  it('client-type tenant: OT and report sections unavailable, equipment by state available', async () => {
    const r = await operativosSvc.operativos(ctxFor({ caps: { executesServices: false, usesQrs: false, usesRequisiciones: false } }));
    assert.deepEqual(r.otsPorEstado, { disponible: false });
    assert.deepEqual(r.preventivoVsCorrectivo, { disponible: false });
    assert.equal(r.equiposPorEstadoOperativo.disponible, true);
  });

  it('isolation: tenant B counts only its own', async () => {
    const r = await operativosSvc.operativos(ctxFor({ tenantId: 'tenant-b' }));
    assert.deepEqual(r.equiposPorEstadoOperativo.items, [{ estado: 'En Reparacion', cantidad: 2 }]);
    assert.deepEqual(r.ticketsAbiertos, { disponible: true, cantidad: 5 });
    assert.deepEqual(r.requisicionesPendientes, { disponible: true, cantidad: 4 });
    assertTenantOnly('tenant-b');
  });
});

describe('dashboard alertas', () => {
  it('overdue work orders and equipment without maintenance, oldest first', async () => {
    const r = await operativosSvc.alertas(ctxFor());
    assert.equal(r.otsVencidas.cantidad, 1);
    assert.deepEqual(r.otsVencidas.items, [{ otId: String(OT3), consecutivo: 'OT-3', cliente: 'Beta', diasAbierta: 73 }]);
    assert.equal(r.equiposSinMantenimiento.cantidad, 2);
    assert.deepEqual(r.equiposSinMantenimiento.items.map((e) => [e.nombre, e.ultimoMtto]), [['Monitor', null], ['Bomba', '2025-01-01T00:00:00.000Z']]);
    assertTenantOnly('tenant-a');
  });

  it('an unfinished OT of 29 days is not overdue; a finished old one is not either', async () => {
    db.restore();
    const data = buildData();
    data.OT.rows = [
      { _id: id(), tenantId: 'tenant-a', isDeleted: false, Consecutivo: 'N', ClienteId: C1, EstadoOt: 'Pendiente', FechaCreacion: new Date(NOW.getTime() - 29 * 86400000) },
      { _id: id(), tenantId: 'tenant-a', isDeleted: false, Consecutivo: 'F', ClienteId: C1, EstadoOt: 'Cerrado', FechaCreacion: new Date('2026-01-01T00:00:00Z') },
    ];
    db = installFakeDb(data);
    const r = await operativosSvc.alertas(ctxFor());
    assert.equal(r.otsVencidas.cantidad, 0);
  });

  it('alertas apply customer and type to overdue OTs and declare the filters that do not apply', async () => {
    const byCliente = await operativosSvc.alertas(ctxFor({ query: { clienteId: String(C1) } }));
    assert.equal(byCliente.otsVencidas.cantidad, 0); // OT-3 belongs to Beta
    const byTipo = await operativosSvc.alertas(ctxFor({ query: { tipoMtto: 'Correctivo' } }));
    assert.equal(byTipo.otsVencidas.cantidad, 0); // OT-3 is Preventivo
    const sent = await operativosSvc.alertas(ctxFor({ query: { sedeId: String(S1), servicioId: String(SV1), tipoMtto: 'Preventivo', tecnicoId: String(U1) } }));
    assert.deepEqual([...sent.filtrosNoAplicados].sort(), ['sedeId', 'servicioId', 'tecnicoId', 'tipoMtto']);
    assert.deepEqual((await operativosSvc.alertas(ctxFor())).filtrosNoAplicados, []);
    const client = await operativosSvc.alertas(ctxFor({ caps: { executesServices: false }, query: { sedeId: String(S1), tipoMtto: 'Preventivo' } }));
    assert.deepEqual(client.filtrosNoAplicados, ['tipoMtto']);
  });

  it('isolation and capability', async () => {
    const b = await operativosSvc.alertas(ctxFor({ tenantId: 'tenant-b' }));
    assert.deepEqual(b.otsVencidas.items.map((o) => o.consecutivo), ['OT-B']);
    assert.equal(b.otsVencidas.items[0].cliente, 'OtherTenant');
    assert.equal(b.equiposSinMantenimiento.cantidad, 2);
    assertTenantOnly('tenant-b');
    const client = await operativosSvc.alertas(ctxFor({ caps: { executesServices: false } }));
    assert.deepEqual(client.otsVencidas, { disponible: false });
    assert.equal(client.equiposSinMantenimiento.disponible, true);
  });
});

describe('own-customer tenants (managesCustomers off)', () => {
  const own = { executesServices: true, managesCustomers: false, usesQrs: false, usesRequisiciones: false };

  it('forces the customer filter to the organization customer, ignoring the one sent', async () => {
    const ctx = ctxFor({ caps: own, organizationCustomerId: String(C1), query: { clienteId: String(C2) } });
    assert.equal(ctx.filters.clienteId, String(C1));
    const r = await cumplimientoSvc.cumplimiento(ctx);
    assert.equal(r.programadas, 2); // e1, e2 (Acme); e4 (Beta) excluded
    assert.deepEqual(r.porCliente.map((c) => c.cliente), ['Acme']);
  });

  it('a clienteId that is not of the tenant yields empty results, not an error', async () => {
    const r = await cumplimientoSvc.cumplimiento(ctxFor({ query: { clienteId: String(CB) } }));
    assert.equal(r.programadas, 0);
    assert.deepEqual(r.porCliente, []);
  });
});
