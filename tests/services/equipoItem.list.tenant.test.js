/**
 * Isolation of GET /equipo-items (change: dashboard-por-tenant-indicadores, tasks 1.1/1.2).
 * DB-free: EquipoItem statics are monkey-patched with a store that honours the tenantId of the filter.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { EquipoItemController } from '../../src/controllers/equipoitem.controller.js';

const CLIENTE_1 = '507f1f77bcf86cd799439001';
const CLIENTE_2 = '507f1f77bcf86cd799439002';
const STORE = [
  { _id: 'a1', tenantId: 'tenant-a', ClienteId: CLIENTE_1 },
  { _id: 'a2', tenantId: 'tenant-a', ClienteId: CLIENTE_2 },
  { _id: 'b1', tenantId: 'tenant-b', ClienteId: CLIENTE_1 },
  { _id: 'b2', tenantId: 'tenant-b', ClienteId: CLIENTE_1 },
  { _id: 'b3', tenantId: 'tenant-b', ClienteId: CLIENTE_2 },
];

const orig = { find: EquipoItem.find, count: EquipoItem.countDocuments, agg: EquipoActividadExterna.aggregate };
afterEach(() => {
  EquipoItem.find = orig.find;
  EquipoItem.countDocuments = orig.count;
  EquipoActividadExterna.aggregate = orig.agg;
});

function arrange() {
  const seen = { find: null, count: null };
  const rows = (filter) => STORE.filter((d) => (!filter.tenantId || d.tenantId === filter.tenantId) && (!filter.ClienteId || String(d.ClienteId) === String(filter.ClienteId)));
  EquipoItem.find = (filter) => {
    seen.find = filter;
    const q = { populate: () => q, sort: () => q, skip: () => q, limit: () => q, lean: () => Promise.resolve(rows(filter)) };
    return q;
  };
  EquipoItem.countDocuments = async (filter) => { seen.count = filter; return rows(filter).length; };
  EquipoActividadExterna.aggregate = async () => [];
  return seen;
}

describe('equipoItemService.list: tenant isolation', () => {
  it('without ClienteId returns and counts only the request tenant', async () => {
    const seen = arrange();
    const r = await equipoItemService.list({}, {}, 'tenant-a', {});
    assert.deepEqual(r.data.map((d) => d._id), ['a1', 'a2']);
    assert.equal(r.pagination.total, 2);
    assert.equal(seen.find.tenantId, 'tenant-a');
    assert.equal(seen.count.tenantId, 'tenant-a');
  });

  it('with ClienteId still scopes to the tenant (same customer id in both tenants)', async () => {
    arrange();
    const r = await equipoItemService.list({ ClienteId: CLIENTE_1 }, {}, 'tenant-b', {});
    assert.deepEqual(r.data.map((d) => d._id), ['b1', 'b2']);
    assert.equal(r.pagination.total, 2);
  });

  it('a tenantId smuggled in the filters cannot override the request tenant', async () => {
    const seen = arrange();
    const r = await equipoItemService.list({ tenantId: 'tenant-b' }, {}, 'tenant-a', {});
    assert.equal(seen.find.tenantId, 'tenant-a');
    assert.equal(r.data.every((d) => d.tenantId === 'tenant-a'), true);
  });

  it('throws 400 TENANT_REQUIRED (not a 500, no query) when there is no tenant', async () => {
    const seen = arrange();
    for (const tenant of [undefined, null, '']) {
      await assert.rejects(
        () => equipoItemService.list({}, {}, tenant, {}),
        (e) => e.statusCode === 400 && e.code === 'TENANT_REQUIRED',
      );
    }
    assert.equal(seen.find, null);
    assert.equal(seen.count, null);
  });
});

describe('EquipoItemController.list passes the request tenant', () => {
  it('GET /equipo-items uses req.tenantId and drops a client-sent tenantId', async () => {
    const seen = arrange();
    const controller = new EquipoItemController();
    const req = { query: { tenantId: 'tenant-b' }, tenantId: 'tenant-a', tenant: { capabilities: {} } };
    const res = { json(body) { this.body = body; return this; } };
    await controller.list(req, res, (e) => { throw e; });
    assert.equal(seen.find.tenantId, 'tenant-a');
    assert.equal(res.body.pagination.total, 2);
  });

  it('forwards TENANT_REQUIRED to next() for a superadmin outside view-as', async () => {
    arrange();
    const controller = new EquipoItemController();
    let err;
    await controller.list({ query: {}, tenant: undefined }, {}, (e) => { err = e; });
    assert.equal(err.code, 'TENANT_REQUIRED');
  });
});

describe('equipoItemService: getById / update / delete / updateAndSnapshot are tenant scoped', () => {
  const saved = { findOne: EquipoItem.findOne, findOneAndUpdate: EquipoItem.findOneAndUpdate, findById: EquipoItem.findById, findByIdAndUpdate: EquipoItem.findByIdAndUpdate };
  afterEach(() => { Object.assign(EquipoItem, saved); });

  function arrangeWrites() {
    const writes = [];
    const hit = (f) => STORE.find((d) => d._id === f._id && (!f.tenantId || d.tenantId === f.tenantId)) || null;
    const chain = (doc) => { const q = { select: () => q, populate: () => q, lean: () => q, then: (res, rej) => Promise.resolve(doc).then(res, rej) }; return q; };
    EquipoItem.findOne = (f) => chain(hit(f));
    EquipoItem.findOneAndUpdate = (f, update) => { const doc = hit(f); if (doc) writes.push({ f, update }); return chain(doc); };
    // legacy unscoped statics must never be used any more
    EquipoItem.findById = () => { throw new Error('findById is not tenant scoped'); };
    EquipoItem.findByIdAndUpdate = () => { throw new Error('findByIdAndUpdate is not tenant scoped'); };
    return writes;
  }
  const nf = (e) => e.statusCode === 404 && e.code === 'NOT_FOUND';

  it('getById: own id is returned, an id of another tenant is 404', async () => {
    arrangeWrites();
    assert.equal((await equipoItemService.getById('a1', 'tenant-a'))._id, 'a1');
    await assert.rejects(() => equipoItemService.getById('b1', 'tenant-a'), nf);
  });

  it('update: another tenant id is 404 and nothing is written (also with a ClienteId / tuple payload)', async () => {
    const writes = arrangeWrites();
    for (const data of [{ Ubicacion: 'x' }, { Ubicacion: 'x', EstadoOperativo: 'Operativo' }, { Serie: 'Z9' }]) {
      await assert.rejects(() => equipoItemService.update('b1', data, 'tenant-a'), nf);
    }
    assert.equal(writes.length, 0);
    const ok = await equipoItemService.update('a1', { Ubicacion: 'x', tenantId: 'tenant-b' }, 'tenant-a');
    assert.equal(ok._id, 'a1');
    assert.equal(writes[0].f.tenantId, 'tenant-a');
    assert.equal('tenantId' in writes[0].update.$set, false, 'a body cannot move the equipment to another tenant');
  });

  it('delete: another tenant id is 404 and nothing is written', async () => {
    const writes = arrangeWrites();
    await assert.rejects(() => equipoItemService.delete('b1', 'tenant-a'), nf);
    assert.equal(writes.length, 0);
  });

  it('updateAndSnapshot: another tenant id is 404 and nothing is written', async () => {
    const writes = arrangeWrites();
    await assert.rejects(() => equipoItemService.updateAndSnapshot('b1', { Ubicacion: 'x' }, 'tenant-a'), nf);
    await assert.rejects(() => equipoItemService.updateAndSnapshot('b1', { Ubicacion: 'x', tenantId: 'tenant-b' }, 'tenant-a'), nf);
    assert.equal(writes.length, 0);
  });

  it('every method requires a tenant (400 TENANT_REQUIRED)', async () => {
    arrangeWrites();
    const tr = (e) => e.statusCode === 400 && e.code === 'TENANT_REQUIRED';
    await assert.rejects(() => equipoItemService.getById('a1'), tr);
    await assert.rejects(() => equipoItemService.update('a1', { Ubicacion: 'x' }), tr);
    await assert.rejects(() => equipoItemService.delete('a1'), tr);
    await assert.rejects(() => equipoItemService.updateAndSnapshot('a1', { Ubicacion: 'x', tenantId: 'tenant-a' }), tr);
  });
});

describe('equipoItemService.list: search is escaped', () => {
  it('a catastrophic pattern is matched literally and returns promptly', async () => {
    const seen = arrange();
    const started = Date.now();
    await equipoItemService.list({}, { search: '(a+)+$' }, 'tenant-a', {});
    assert.ok(Date.now() - started < 1000);
    const rx = seen.find.$or[0].name;
    assert.equal(rx.source, String.raw`\(a\+\)\+\$`);
    assert.equal(rx.test('x'.repeat(40) + '!'), false);
  });
});
