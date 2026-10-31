import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { repuestosService } from '../src/services/repuestos.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';
import { paramsRepuestosIdDto } from '../src/dtos/paramsRepuestosId.dto.js';
import { repuestosController } from '../src/controllers/repuestos.controller.js';

const ID = '507f1f77bcf86cd799439011';
const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

// In-memory doc of tenant-b; every query must carry its tenantId to match.
function world() {
  const doc = { _id: ID, tenantId: 'tenant-b', EstadoSolicitud: 'Solicitado', isDeleted: false };
  const w = { doc, writes: 0, traces: 0 };
  const matches = (f) => String(f._id) === ID && (f.tenantId === undefined ? true : f.tenantId === doc.tenantId);
  stub(Repuestos, 'findOne', (f) => ({ lean: async () => (matches(f) ? { ...doc } : null) }));
  stub(Repuestos, 'findOneAndUpdate', async (f, u) => {
    if (!matches(f)) return null;
    w.writes += 1;
    Object.assign(doc, u.$set);
    return doc;
  });
  stub(Repuestos, 'findById', () => { throw new Error('bare findById must not be used'); });
  stub(Repuestos, 'findByIdAndUpdate', () => { throw new Error('bare findByIdAndUpdate must not be used'); });
  stub(RepuestoTrazabilidad, 'create', async () => { w.traces += 1; });
  return w;
}

describe('Repuestos update/delete tenant isolation', () => {
  it('foreign tenant update returns 404 and writes nothing', async () => {
    const w = world();
    await assert.rejects(
      () => repuestosService.update(ID, { EstadoSolicitud: 'Rechazado' }, 'tenant-a'),
      (e) => e.statusCode === 404 && e.code === 'NOT_FOUND',
    );
    assert.equal(w.writes, 0);
    assert.equal(w.traces, 0);
    assert.equal(w.doc.EstadoSolicitud, 'Solicitado');
  });

  it('foreign tenant delete returns 404 and writes nothing', async () => {
    const w = world();
    await assert.rejects(
      () => repuestosService.delete(ID, 'tenant-a'),
      (e) => e.statusCode === 404 && e.code === 'NOT_FOUND',
    );
    assert.equal(w.writes, 0);
    assert.equal(w.doc.isDeleted, false);
  });

  it('same tenant update and delete still work (with trace)', async () => {
    const w = world();
    const e = await repuestosService.update(ID, { EstadoSolicitud: 'Rechazado' }, 'tenant-b');
    assert.equal(e.EstadoSolicitud, 'Rechazado');
    assert.equal(w.traces, 1);
    await repuestosService.delete(ID, 'tenant-b');
    assert.equal(w.doc.isDeleted, true);
  });

  it('a tenantId in the body cannot move the document', async () => {
    const w = world();
    await repuestosService.update(ID, { tenantId: 'tenant-a', EstadoSolicitud: 'Rechazado' }, 'tenant-b');
    assert.equal(w.doc.tenantId, 'tenant-b');
  });

  it('missing tenant fails closed without touching the DB', async () => {
    const w = world();
    await assert.rejects(() => repuestosService.update(ID, {}, undefined));
    await assert.rejects(() => repuestosService.delete(ID, undefined));
    assert.equal(w.writes, 0);
  });

  it('controllers pass req.tenantId (PUT/PATCH share update)', async () => {
    const w = world();
    const res = { json() {}, status() { return this; } };
    for (const fn of ['update', 'delete']) {
      let err;
      await repuestosController[fn]({ params: { id: ID }, body: {}, tenantId: 'tenant-a' }, res, (e) => { err = e; });
      assert.equal(err?.statusCode, 404, fn);
    }
    assert.equal(w.writes, 0);
  });

  it('params DTO rejects a non-ObjectId id and accepts a valid one', () => {
    assert.ok(paramsRepuestosIdDto.validate({ id: 'not-an-id' }).error);
    assert.ok(paramsRepuestosIdDto.validate({ id: '123' }).error);
    assert.equal(paramsRepuestosIdDto.validate({ id: ID }).error, undefined);
  });
});
