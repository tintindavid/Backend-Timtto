/**
 * tests/services/cronogramaActividadesExternas.service.test.js
 * cronograma-actividades-externas, tasks 3.2 / 4.2. DB-free: the three models are stubbed and
 * the stubs honour the tenantId in the filter so the isolation cases are meaningful.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { listarActividadesExternas, DEFAULT_LIMIT, MAX_LIMIT } from '../../src/services/cronogramaActividadesExternas.service.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const A = 'tenant-a';
const B = 'tenant-b';
const CLI1 = '507f1f77bcf86cd799439001';
const CLI2 = '507f1f77bcf86cd799439002';
const EQ1 = '507f1f77bcf86cd799439011';
const EQ2 = '507f1f77bcf86cd799439012';
const EQ_DELETED = '507f1f77bcf86cd799439013';
const PROV = '507f1f77bcf86cd799439021';

const chain = (over) => ({
  _id: `c-${Math.random().toString(16).slice(2, 8)}`,
  tenantId: A, clienteId: CLI1, equipoId: EQ1, tipo: 'calibracion', frecuenciaMeses: 6,
  fechaProxima: new Date('2026-12-10T00:00:00Z'), estado: 'vigente',
  actividadVigenteId: { proveedor: 'ACME', proveedorId: PROV },
  ...over,
});

let chainFilter;
let chainLimit;
let actFilter;

function stub({ chains, equipos, clientes, actividades = [] }) {
  CadenaActividad.find = (filter) => {
    chainFilter = filter;
    const rows = chains.filter((c) => c.tenantId === filter.tenantId
      && c.estado === filter.estado
      && c.fechaProxima !== null
      && (!filter.clienteId || c.clienteId === filter.clienteId)
      && (!filter.tipo || c.tipo === filter.tipo));
    const q = {
      sort() { return q; },
      limit(n) { chainLimit = n; q.rows = rows.slice(0, n); return q; },
      populate() { return q; },
      lean: () => Promise.resolve(q.rows ?? rows),
    };
    return q;
  };
  EquipoItem.find = (filter) => {
    const ids = filter._id.$in.map(String);
    const rows = equipos.filter((e) => e.tenantId === filter.tenantId && !e.isDeleted && ids.includes(String(e._id)));
    const q = { select() { return q; }, populate() { return q; }, lean: () => Promise.resolve(rows) };
    return q;
  };
  EquipoActividadExterna.find = (filter) => {
    actFilter = filter;
    const ids = filter.cadenaId.$in.map(String);
    const rows = actividades.filter((a) => a.tenantId === filter.tenantId && ids.includes(String(a.cadenaId)));
    const q = { select() { return q; }, lean: () => Promise.resolve(rows) };
    return q;
  };
  Customer.find = (filter) => {
    const ids = filter._id.$in.map(String);
    const rows = clientes.filter((c) => c.tenantId === filter.tenantId && ids.includes(String(c._id)));
    const q = { select() { return q; }, lean: () => Promise.resolve(rows) };
    return q;
  };
}

const baseData = () => ({
  equipos: [
    { _id: EQ1, tenantId: A, ItemId: { Nombre: 'Monitor' }, Marca: 'GE', Modelo: 'B20', Serie: 'S1', Inventario: 'I1', Ubicacion: 'UCI' },
    { _id: EQ2, tenantId: A, ItemId: { Nombre: 'Bomba' }, Marca: 'BD', Modelo: 'X', Serie: 'S2' },
    { _id: EQ_DELETED, tenantId: A, isDeleted: true, ItemId: { Nombre: 'Viejo' }, Marca: 'Z', Serie: 'S3' },
  ],
  clientes: [
    { _id: CLI1, tenantId: A, Razonsocial: 'Hospital Uno' },
    { _id: CLI2, tenantId: A, Razonsocial: 'Hospital Dos' },
  ],
});

afterEach(() => {
  delete CadenaActividad.find;
  delete EquipoItem.find;
  delete Customer.find;
  delete EquipoActividadExterna.find;
  actFilter = undefined;
  chainFilter = undefined;
  chainLimit = undefined;
});

describe('listarActividadesExternas', () => {
  it('returns the scheduled fields with months, overdue data, provider, equipment and client', async () => {
    stub({ ...baseData(), chains: [chain({})] });
    const { data, truncated } = await listarActividadesExternas(A, {}, NOW);
    assert.equal(truncated, false);
    assert.equal(data.length, 1);
    const [row] = data;
    assert.deepEqual(row.meses, ['jun', 'dic']);
    assert.equal(row.vencida, false);
    assert.equal(row.diasParaVencer, 52);
    assert.equal(row.proveedor, 'ACME');
    assert.equal(row.proveedorId, PROV);
    assert.equal(row.tipo, 'calibracion');
    assert.equal(row.frecuenciaMeses, 6);
    assert.equal(row.equipo.nombre, 'Monitor');
    assert.equal(row.equipo.serie, 'S1');
    assert.equal(row.cliente.razonsocial, 'Hospital Uno');
  });

  it('always filters by the tenant and by vigente chains with a due date', async () => {
    stub({ ...baseData(), chains: [] });
    await listarActividadesExternas(A, {}, NOW);
    assert.equal(chainFilter.tenantId, A);
    assert.equal(chainFilter.estado, 'vigente');
    assert.deepEqual(chainFilter.fechaProxima, { $ne: null });
  });

  it('never returns chains of another tenant', async () => {
    stub({ ...baseData(), chains: [chain({ tenantId: B }), chain({})] });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.equal(data.length, 1);
  });

  it('drops closed, abandoned and single-shot chains', async () => {
    stub({
      ...baseData(),
      chains: [
        chain({ estado: 'cerrada_manualmente' }),
        chain({ estado: 'abandonada' }),
        chain({ fechaProxima: null, esUnica: true }),
        chain({}),
      ],
    });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.equal(data.length, 1);
  });

  it('drops chains whose equipment was soft-deleted', async () => {
    stub({ ...baseData(), chains: [chain({ equipoId: EQ_DELETED }), chain({ equipoId: EQ2 })] });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.deepEqual(data.map((d) => d.equipoId), [EQ2]);
  });

  it('filters by clienteId', async () => {
    stub({ ...baseData(), chains: [chain({ clienteId: CLI1 }), chain({ clienteId: CLI2, equipoId: EQ2 })] });
    const { data } = await listarActividadesExternas(A, { clienteId: CLI2 }, NOW);
    assert.deepEqual(data.map((d) => d.clienteId), [CLI2]);
    assert.equal(chainFilter.clienteId, CLI2);
  });

  it('filters by tipo', async () => {
    stub({ ...baseData(), chains: [chain({ tipo: 'calibracion' }), chain({ tipo: 'verificacion', equipoId: EQ2 })] });
    const { data } = await listarActividadesExternas(A, { tipo: 'verificacion' }, NOW);
    assert.deepEqual(data.map((d) => d.tipo), ['verificacion']);
  });

  it('filters by month using the recurring months', async () => {
    stub({
      ...baseData(),
      chains: [
        chain({ fechaProxima: new Date('2026-03-10T00:00:00Z'), frecuenciaMeses: 6 }),
        chain({ fechaProxima: new Date('2026-06-10T00:00:00Z'), frecuenciaMeses: 12, equipoId: EQ2 }),
      ],
    });
    const sep = await listarActividadesExternas(A, { mes: 'sep' }, NOW);
    assert.equal(sep.data.length, 1);
    assert.deepEqual(sep.data[0].meses, ['mar', 'sep']);
    const jun = await listarActividadesExternas(A, { mes: 'jun' }, NOW);
    assert.equal(jun.data.length, 1);
    assert.deepEqual(jun.data[0].meses, ['jun']);
    const none = await listarActividadesExternas(A, { mes: 'ene' }, NOW);
    assert.deepEqual(none.data, []);
  });

  it('flags an overdue chain', async () => {
    stub({ ...baseData(), chains: [chain({ fechaProxima: new Date('2026-10-09T00:00:00Z') })] });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.equal(data[0].vencida, true);
    assert.equal(data[0].diasParaVencer, -10);
  });

  it('handles a chain without a provider on its vigente activity', async () => {
    stub({ ...baseData(), chains: [chain({ actividadVigenteId: null })] });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.equal(data[0].proveedor, null);
    assert.equal(data[0].proveedorId, null);
  });

  it('caps the result and marks it truncated', async () => {
    const chains = [chain({ equipoId: EQ1 }), chain({ equipoId: EQ2 }), chain({ equipoId: EQ1 })];
    stub({ ...baseData(), chains });
    const { data, truncated } = await listarActividadesExternas(A, { limit: 2 }, NOW);
    assert.equal(chainLimit, 3);
    assert.equal(truncated, true);
    assert.equal(data.length, 2);
  });

  it('limits are bounded', async () => {
    stub({ ...baseData(), chains: [] });
    await listarActividadesExternas(A, {}, NOW);
    assert.equal(chainLimit, DEFAULT_LIMIT + 1);
    await listarActividadesExternas(A, { limit: 99999 }, NOW);
    assert.equal(chainLimit, MAX_LIMIT + 1);
  });

  it('rejects a missing tenant', async () => {
    stub({ ...baseData(), chains: [] });
    await assert.rejects(() => listarActividadesExternas(undefined, {}, NOW));
  });

  it('returns the months executed during the year with their dates', async () => {
    const c = chain({ _id: 'cx', fechaProxima: new Date('2026-10-10T00:00:00Z'), frecuenciaMeses: 6 });
    stub({
      ...baseData(),
      chains: [c],
      actividades: [
        { tenantId: A, cadenaId: 'cx', fecha: new Date('2026-04-10T00:00:00Z') },
        { tenantId: A, cadenaId: 'cx', fecha: new Date('2026-04-02T00:00:00Z') },
        { tenantId: A, cadenaId: 'cx', fecha: new Date('2025-10-02T00:00:00Z') },
      ],
    });
    const { data } = await listarActividadesExternas(A, { anio: 2026 }, NOW);
    assert.deepEqual(data[0].realizadas.map((r) => r.mes), ['abr']);
    assert.equal(new Date(data[0].realizadas[0].fecha).toISOString(), '2026-04-02T00:00:00.000Z');
    assert.equal(actFilter.tenantId, A);
  });

  it('defaults to the current year and ignores activities of other years and tenants', async () => {
    const c = chain({ _id: 'cy' });
    stub({
      ...baseData(),
      chains: [c],
      actividades: [
        { tenantId: B, cadenaId: 'cy', fecha: new Date('2026-05-10T00:00:00Z') },
        { tenantId: A, cadenaId: 'cy', fecha: new Date('2025-05-10T00:00:00Z') },
        { tenantId: A, cadenaId: 'cy', fecha: new Date('2026-06-10T00:00:00Z') },
      ],
    });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.deepEqual(data[0].realizadas.map((r) => r.mes), ['jun']);
  });

  it('a past year reports its own executed months', async () => {
    const c = chain({ _id: 'cz' });
    stub({ ...baseData(), chains: [c], actividades: [{ tenantId: A, cadenaId: 'cz', fecha: new Date('2025-05-10T00:00:00Z') }] });
    const { data } = await listarActividadesExternas(A, { anio: 2025 }, NOW);
    assert.deepEqual(data[0].realizadas.map((r) => r.mes), ['may']);
  });

  it('realizadas is empty when nothing was registered in the year', async () => {
    stub({ ...baseData(), chains: [chain({})] });
    const { data } = await listarActividadesExternas(A, {}, NOW);
    assert.deepEqual(data[0].realizadas, []);
  });

  it('does not project months before the chain started', async () => {
    // monthly chain, first activity on 2026-09-25, due 2026-10-25
    const c = chain({ _id: 'cm', frecuenciaMeses: 1, fechaProxima: new Date('2026-10-25T00:00:00Z') });
    stub({
      ...baseData(),
      chains: [c],
      actividades: [{ tenantId: A, cadenaId: 'cm', fecha: new Date('2026-09-25T00:00:00Z') }],
    });
    const current = await listarActividadesExternas(A, {}, NOW);
    assert.deepEqual(current.data[0].meses, ['sep', 'oct', 'nov', 'dic']);
    const before = await listarActividadesExternas(A, { anio: 2025 }, NOW);
    assert.deepEqual(before.data[0].meses, []);
    const after = await listarActividadesExternas(A, { anio: 2027 }, NOW);
    assert.equal(after.data[0].meses.length, 12);
  });

  it('computes the months for the requested year', async () => {
    const c = chain({ _id: 'cn', frecuenciaMeses: 5, fechaProxima: new Date('2026-01-10T00:00:00Z') });
    stub({ ...baseData(), chains: [c] });
    const y26 = await listarActividadesExternas(A, { anio: 2026 }, NOW);
    assert.deepEqual(y26.data[0].meses, ['ene', 'jun', 'nov']);
    const y27 = await listarActividadesExternas(A, { anio: 2027 }, NOW);
    assert.deepEqual(y27.data[0].meses, ['abr', 'sep']);
  });

  it('the mes filter uses the months of the requested year', async () => {
    const c = chain({ _id: 'co', frecuenciaMeses: 5, fechaProxima: new Date('2026-01-10T00:00:00Z') });
    stub({ ...baseData(), chains: [c] });
    const hit = await listarActividadesExternas(A, { anio: 2027, mes: 'abr' }, NOW);
    assert.equal(hit.data.length, 1);
    const miss = await listarActividadesExternas(A, { anio: 2027, mes: 'ene' }, NOW);
    assert.equal(miss.data.length, 0);
  });
});
