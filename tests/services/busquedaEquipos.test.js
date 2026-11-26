import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDb } from '../helpers/dashboardFakeDb.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Items } from '../../src/models/items.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Servicios } from '../../src/models/servicios.model.js';
import { HVEquipo } from '../../src/models/hvequipo.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { busquedaEquiposService } from '../../src/services/busquedaEquipos.service.js';
import { resumenEquipoService } from '../../src/services/resumenEquipo.service.js';
import { buildBusquedaContext } from '../../src/utils/busquedaContext.util.js';
import { busquedaEquiposQueryDto } from '../../src/dtos/busqueda.dto.js';
import busquedaRoutes from '../../src/routes/busqueda.routes.js';
import { ALL_CAPABILITIES_ENABLED } from '../../src/config/tenantCapabilities.config.js';

const T = 'acme';
const ALL_PERMISSIONS = ['equipo-items:read', 'hv-equipos:read', 'reports:read', 'tickets:read', 'repuestos:read'];
const MODELS = {
  EquipoItem, Items, Customer, Sedes, Servicios, HVEquipo, Report, OT, EquipoActividadExterna, Ticket, Repuestos,
};

const base = (_id, extra = {}) => ({ _id, tenantId: T, isDeleted: false, ...extra });

const equipo = (_id, extra = {}) => base(_id, {
  ClienteId: 'c1', SedeId: 's1', Servicio: 'v1', ItemId: 'i1',
  Marca: 'Mindray', Modelo: 'BeneView', Serie: `SN-${_id}`, Estado: 'Activo', EstadoOperativo: 'Operativo', ...extra,
});

const ctx = (extra = {}) => ({
  tenantId: T, isSuperadmin: false, permissions: ALL_PERMISSIONS,
  capabilities: { ...ALL_CAPABILITIES_ENABLED }, clienteId: null, ...extra,
});

let db;
function install(rows = {}) {
  const defaults = {
    Items: [base('i1', { Nombre: 'Monitor', Foto: 'item.png' })],
    Customer: [base('c1', { Razonsocial: 'Clinica Uno' })],
    Sedes: [base('s1', { nombreSede: 'Norte' })],
    Servicios: [base('v1', { nombre: 'UCI' })],
  };
  db = installFakeDb(Object.fromEntries(Object.entries(MODELS)
    .map(([name, Model]) => [name, { Model, rows: rows[name] || defaults[name] || [] }])));
}

const search = (q, extra = {}, context = ctx()) => busquedaEquiposService.buscar(context, { q, ...extra });
const ids = (rows) => rows.map((r) => r._id);

describe('equipment search', () => {
  afterEach(() => db?.restore());

  it('ignores separators and case on both sides and reports the matched field', async () => {
    install({ EquipoItem: [equipo('e1', { Serie: 'AB-123' }), equipo('e2', { Serie: 'ZZ', Inventario: 'a b/9.9' })] });
    const rows = await search('ab123');
    assert.deepEqual(rows, [{
      _id: 'e1', nombre: 'Monitor', marca: 'Mindray', modelo: 'BeneView', serie: 'AB-123', inventario: null,
      estadoOperativo: 'Operativo', cliente: { _id: 'c1', nombre: 'Clinica Uno' }, sede: 'Norte', servicio: 'UCI',
      coincidencia: { campo: 'serie', valor: 'AB-123' },
    }]);
    const [byInventory] = await search('AB_99');
    assert.deepEqual(byInventory.coincidencia, { campo: 'inventario', valor: 'a b/9.9' });
  });

  it('requires every word to match some field', async () => {
    install({ EquipoItem: [equipo('e1'), equipo('e2', { Marca: 'Philips' })] });
    assert.deepEqual(ids(await search('mindray bene')), ['e1']);
    assert.deepEqual(await search('mindray nothing'), []);
  });

  it('orders exact, then prefix, then contains, and keeps the exact one under the cap', async () => {
    install({
      EquipoItem: [
        equipo('contains', { Serie: 'A-100' }),
        equipo('prefix', { Serie: '1000' }),
        equipo('exact', { Serie: 'zz', Inventario: '1-00' }),
      ],
    });
    assert.deepEqual(ids(await search('100')), ['exact', 'prefix', 'contains']);
    assert.deepEqual(ids(await search('100', { limit: 1 })), ['exact']);
    assert.deepEqual(ids(await search('100', { limit: 2 })), ['exact', 'prefix']);
  });

  it('treats regex metacharacters literally', async () => {
    install({ EquipoItem: [equipo('e1', { Serie: 'AXB' }), equipo('e2', { Serie: 'A(*)B' })] });
    assert.deepEqual(ids(await search('(*)')), ['e2']);
    assert.deepEqual(await search('a+'), []);
  });

  it('never returns other tenants or deleted rows, and every query carries the tenant', async () => {
    install({ EquipoItem: [equipo('e1'), equipo('other', { tenantId: 'beta' }), equipo('gone', { isDeleted: true })] });
    assert.deepEqual(ids(await search('mindray')), ['e1']);
    assert.ok(db.calls.every((c) => c.filter.tenantId === T));
  });

  it('limits a tenant scoped to its own customer', async () => {
    install({ EquipoItem: [equipo('own', { ClienteId: 'org' }), equipo('foreign')] });
    assert.deepEqual(ids(await search('mindray', {}, ctx({ clienteId: 'org' }))), ['own']);
  });
});

describe('equipment search request', () => {
  it('rejects short, long or unknown query values and discards tenantId', () => {
    for (const query of [{}, { q: 'a' }, { q: 'a - .' }, { q: 'x'.repeat(61) }, { q: 'ab', limit: 21 }, { q: 'ab', other: 1 }]) {
      assert.ok(busquedaEquiposQueryDto.validate(query).error, JSON.stringify(query));
    }
    assert.deepEqual(busquedaEquiposQueryDto.validate({ q: ' ab ', tenantId: 'beta' }).value, { q: 'ab', limit: 8 });
  });

  it('requires an effective tenant', () => {
    for (const tenantId of [undefined, '__platform__']) {
      assert.throws(() => buildBusquedaContext({ tenantId }), { statusCode: 400, code: 'TENANT_REQUIRED' });
    }
  });

  it('guards both routes with equipo-items:read', () => {
    const routes = busquedaRoutes.stack.filter((layer) => layer.route);
    assert.deepEqual(routes.map((l) => l.route.path), ['/equipos', '/equipos/:id/resumen']);
    for (const { route } of routes) {
      let error;
      route.stack[0].handle({ user: { role: 'tecnico', permissions: [] } }, {}, (err) => { error = err; });
      assert.equal(error?.code, 'FORBIDDEN');
    }
  });
});

describe('equipment summary', () => {
  afterEach(() => db?.restore());

  const world = () => ({
    EquipoItem: [equipo('e1', { UltimoMtto: new Date('2026-03-01T00:00:00Z'), ProximoMtto: 'sep', mesesMtto: ['mar', 'sep'] })],
    HVEquipo: [base('h1', { EquipoId: 'e1', EstadoHV: 'Aprobada', Foto: 'hv.png' })],
    Report: [
      ...[1, 2, 3, 4, 5, 6].map((n) => base(`r${n}`, { Equipo: 'e1', fechaFinalizdo: new Date(`2026-0${n}-01T00:00:00Z`), orden: 'o1' })),
      base('rx', { Equipo: 'e1', tenantId: 'beta' }),
      base('rd', { Equipo: 'e1', isDeleted: true }),
    ],
    OT: [base('o1', { Consecutivo: 'OT-1' })],
    EquipoActividadExterna: [base('a1', { equipoId: 'e1', tipo: 'calibracion', consecutivoExterno: 'X1', fecha: new Date('2026-01-01T00:00:00Z') })],
    Ticket: [base('t1', { equipoId: 'e1', consecutivo: 'TKT-1', createdAt: new Date('2026-01-01T00:00:00Z') })],
    Repuestos: [base('p1', { EquipoId: 'e1', nombre: 'Sensor', Cantidad: '2' })],
  });
  const queried = (...names) => db.calls.filter((c) => names.includes(c.model));

  it('returns identity, the resume sheet photo and the 5 newest rows with the total', async () => {
    install(world());
    const data = await resumenEquipoService.resumen(ctx(), 'e1');
    assert.equal(data.equipo.foto, 'hv.png');
    assert.equal(data.equipo.ultimoMtto, '2026-03-01T00:00:00.000Z');
    assert.equal(data.equipo.proximoMtto, 'sep');
    assert.deepEqual(data.cliente, { _id: 'c1', nombre: 'Clinica Uno' });
    assert.deepEqual(data.hojaVida, { disponible: true, existe: true, _id: 'h1', estado: 'Aprobada' });
    assert.equal(data.mantenimientos.total, 6);
    assert.deepEqual(ids(data.mantenimientos.recientes), ['r6', 'r5', 'r4', 'r3', 'r2']);
    assert.deepEqual(data.mantenimientos.recientes[0].ot, { _id: 'o1', consecutivo: 'OT-1' });
    for (const key of ['actividadesExternas', 'tickets', 'repuestos']) assert.equal(data[key].total, 1, key);
    assert.ok(db.calls.every((c) => c.filter.tenantId === T));
  });

  it('gates sections by permission without querying them, and falls back to the item photo', async () => {
    install(world());
    const data = await resumenEquipoService.resumen(ctx({ permissions: ['equipo-items:read'] }), 'e1');
    assert.equal(data.equipo.foto, 'item.png');
    assert.deepEqual(data.hojaVida, { disponible: false, existe: false, _id: null, estado: null });
    for (const key of ['mantenimientos', 'tickets', 'repuestos']) {
      assert.deepEqual(data[key], { disponible: false, total: 0, recientes: [] }, key);
    }
    assert.equal(data.actividadesExternas.disponible, true);
    assert.deepEqual(queried('HVEquipo', 'Report', 'OT', 'Ticket', 'Repuestos'), []);
  });

  it('gates the premium modules by capability, even with the permission', async () => {
    install(world());
    const capabilities = { ...ALL_CAPABILITIES_ENABLED, registersExternal: false, usesQrs: false };
    const data = await resumenEquipoService.resumen(ctx({ capabilities }), 'e1');
    assert.equal(data.actividadesExternas.disponible, false);
    assert.equal(data.tickets.disponible, false);
    assert.equal(data.mantenimientos.disponible, true);
    assert.deepEqual(queried('EquipoActividadExterna', 'Ticket'), []);
  });

  it('lets a superadmin bypass permissions', async () => {
    install(world());
    const data = await resumenEquipoService.resumen(ctx({ permissions: [], isSuperadmin: true }), 'e1');
    assert.ok([data.hojaVida, data.mantenimientos, data.tickets, data.repuestos].every((s) => s.disponible));
  });

  it('answers 404 for another tenant and for a customer outside the own scope', async () => {
    install(world());
    for (const context of [ctx({ tenantId: 'beta' }), ctx({ clienteId: 'org' })]) {
      await assert.rejects(resumenEquipoService.resumen(context, 'e1'), { statusCode: 404 });
    }
  });
});
