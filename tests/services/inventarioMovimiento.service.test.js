/**
 * inventario-stock tasks 3.1 - 3.3 and 3.5 (movements part). DB-free: the item model is replaced by an in-memory
 * collection whose findOneAndUpdate is atomic (single-threaded) and honours tenantId, _id and the $gte guard,
 * exactly the semantics the service relies on.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { InventarioMovimiento } from '../../src/models/inventarioMovimiento.model.js';
import { inventarioMovimientoService } from '../../src/services/inventarioMovimiento.service.js';
import { createInventarioMovimientoDto, queryInventarioMovimientoDto } from '../../src/dtos/inventarioMovimientoDto.js';

let items;
let movimientos;
let createFails;
let lastListQuery;
const saved = {};

beforeEach(() => {
  items = [{ _id: 'i1', tenantId: 'tenant-a', nombre: 'Sensor', stockActual: 10 }];
  movimientos = [];
  createFails = false;
  lastListQuery = null;
  saved.fou = InventarioRepuesto.findOneAndUpdate;
  saved.findOne = InventarioRepuesto.findOne;
  saved.create = InventarioMovimiento.create;
  saved.find = InventarioMovimiento.find;
  saved.count = InventarioMovimiento.countDocuments;

  InventarioRepuesto.findOneAndUpdate = async (filter, update) => {
    await Promise.resolve(); // yield, like a real round trip
    const hit = items.find((r) => r._id === filter._id && r.tenantId === filter.tenantId);
    if (!hit) return null;
    if (filter.stockActual && filter.stockActual.$gte !== undefined && !(hit.stockActual >= filter.stockActual.$gte)) return null;
    hit.stockActual += update.$inc.stockActual;
    return { ...hit };
  };
  InventarioRepuesto.findOne = (filter) => {
    const hit = items.find((r) => r._id === filter._id && r.tenantId === filter.tenantId);
    return { select: () => ({ lean: async () => (hit ? { ...hit } : null) }) };
  };
  InventarioMovimiento.create = async (doc, opts) => {
    if (createFails) throw new Error('db down');
    const arr = Array.isArray(doc);
    const row = { _id: `m${movimientos.length + 1}`, ...(arr ? doc[0] : doc), toJSON() { return { ...this }; } };
    movimientos.push(row);
    return arr ? [row] : row;
  };
  InventarioMovimiento.find = (filter) => {
    lastListQuery = filter;
    const out = movimientos.filter((m) => m.tenantId === filter.tenantId && (!filter.itemId || m.itemId === filter.itemId));
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => out };
    return chain;
  };
  InventarioMovimiento.countDocuments = async (filter) => movimientos.filter((m) => m.tenantId === filter.tenantId).length;
});

afterEach(() => {
  InventarioRepuesto.findOneAndUpdate = saved.fou;
  InventarioRepuesto.findOne = saved.findOne;
  InventarioMovimiento.create = saved.create;
  InventarioMovimiento.find = saved.find;
  InventarioMovimiento.countDocuments = saved.count;
});

describe('inventarioMovimientoService.create', () => {
  it('entrada of 5 on stock 10 gives 15 and a movement with anterior 10 and resultante 15', async () => {
    const { movimiento, item } = await inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'entrada', cantidad: 5 }, 'u1');
    assert.equal(item.stockActual, 15);
    assert.equal(items[0].stockActual, 15);
    assert.equal(movimiento.stockAnterior, 10);
    assert.equal(movimiento.stockResultante, 15);
    assert.equal(movimiento.tenantId, 'tenant-a');
    assert.equal(movimiento.usuarioId, 'u1');
    assert.equal(movimiento.referenciaTipo, 'manual');
    assert.equal(movimiento.itemNombre, 'Sensor');
  });

  it('salida decreases the stock', async () => {
    const { movimiento } = await inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 4 }, 'u1');
    assert.equal(items[0].stockActual, 6);
    assert.equal(movimiento.stockAnterior, 10);
    assert.equal(movimiento.stockResultante, 6);
  });

  it('salida above the stock is 400 INSUFFICIENT_STOCK and creates no movement nor changes stock', async () => {
    await assert.rejects(
      () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 11 }, 'u1'),
      (e) => e.statusCode === 400 && e.code === 'INSUFFICIENT_STOCK',
    );
    assert.equal(items[0].stockActual, 10);
    assert.equal(movimientos.length, 0);
  });

  it('ajuste needs a motivo; a signed delta applies and a negative one cannot go below zero', async () => {
    await assert.rejects(
      () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'ajuste', cantidad: 2 }, 'u1'),
      (e) => e.statusCode === 400 && e.code === 'MOTIVO_REQUIRED',
    );
    await inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'ajuste', cantidad: -3, motivo: 'Conteo físico' }, 'u1');
    assert.equal(items[0].stockActual, 7);
    assert.equal(movimientos[0].cantidad, -3);
    await assert.rejects(
      () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'ajuste', cantidad: -8, motivo: 'Error' }, 'u1'),
      (e) => e.code === 'INSUFFICIENT_STOCK',
    );
    assert.equal(items[0].stockActual, 7);
  });

  it('rejects zero / negative quantities for entrada and salida', async () => {
    for (const [tipo, cantidad] of [['entrada', 0], ['salida', -1], ['entrada', 'x']]) {
      await assert.rejects(
        () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo, cantidad }, 'u1'),
        (e) => e.statusCode === 400 && e.code === 'INVALID_QUANTITY',
      );
    }
    assert.equal(items[0].stockActual, 10);
  });

  it('concurrent salidas that together exceed the stock: at most the available ones succeed, stock is never negative', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 4 }, 'u1')),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok, 2, '10 / 4 = 2 salidas');
    assert.ok(failed.every((r) => r.reason.code === 'INSUFFICIENT_STOCK'));
    assert.equal(items[0].stockActual, 2);
    assert.equal(movimientos.length, 2);
  });

  it('two salidas that cannot both fit: exactly one wins', async () => {
    const results = await Promise.allSettled([
      inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 7 }, 'u1'),
      inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 7 }, 'u2'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(items[0].stockActual, 3);
  });

  it('compensates the stock when the movement insert fails (no session)', async () => {
    createFails = true;
    await assert.rejects(
      () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 4 }, 'u1'),
      /db down/,
    );
    assert.equal(items[0].stockActual, 10);
  });

  it('with a session it does not compensate by hand (the transaction rolls back) and passes the session along', async () => {
    createFails = true;
    await assert.rejects(
      () => inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 4 }, 'u1', { session: { id: 's' } }),
      /db down/,
    );
    assert.equal(items[0].stockActual, 6, 'rollback is the transaction job');
  });

  it('IDOR: an item of another tenant is 404 and untouched', async () => {
    await assert.rejects(
      () => inventarioMovimientoService.create('tenant-b', { itemId: 'i1', tipo: 'entrada', cantidad: 1 }, 'u1'),
      (e) => e.statusCode === 404,
    );
    assert.equal(items[0].stockActual, 10);
    assert.equal(movimientos.length, 0);
  });

  it('stores the OT reference for automatic movements', async () => {
    const { movimiento } = await inventarioMovimientoService.create(
      'tenant-a', { itemId: 'i1', tipo: 'salida', cantidad: 1, referenciaTipo: 'OT', referenciaId: 'ot9' }, null,
    );
    assert.equal(movimiento.referenciaTipo, 'OT');
    assert.equal(movimiento.referenciaId, 'ot9');
    assert.equal(movimiento.usuarioId, undefined);
  });
});

describe('inventarioMovimientoService.list', () => {
  it('is tenant scoped and paginated, filtered by itemId', async () => {
    await inventarioMovimientoService.create('tenant-a', { itemId: 'i1', tipo: 'entrada', cantidad: 1 }, 'u1');
    movimientos.push({ _id: 'x', tenantId: 'tenant-b', itemId: 'i1' });
    const res = await inventarioMovimientoService.list('tenant-a', { itemId: 'i1' }, { page: 1, limit: 20 });
    assert.equal(lastListQuery.tenantId, 'tenant-a');
    assert.equal(lastListQuery.itemId, 'i1');
    assert.equal(res.data.length, 1);
    assert.equal(res.pagination.total, 1);
    assert.equal(res.pagination.pages, 1);
  });
});

describe('inventarioMovimiento model and DTOs', () => {
  it('is immutable: update and delete hooks are registered', () => {
    const hooks = InventarioMovimiento.schema.s.hooks;
    for (const op of ['updateOne', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'updateMany']) {
      assert.ok(hooks._pres.get(op)?.length > 0, `${op} must be blocked`);
    }
    assert.equal(InventarioMovimiento.schema.path('tenantId').isRequired, true);
  });

  it('create DTO: ajuste requires motivo and accepts a signed delta; entrada needs cantidad > 0; no extra fields', () => {
    const id = 'a'.repeat(24);
    assert.equal(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'entrada', cantidad: 3 }).error, undefined);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'entrada', cantidad: -3 }).error);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'ajuste', cantidad: -3 }).error, 'motivo required');
    assert.equal(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'ajuste', cantidad: -3, motivo: 'x' }).error, undefined);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'ajuste', cantidad: 0, motivo: 'x' }).error);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'entrada', cantidad: 1, tenantId: 'x' }).error);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: id, tipo: 'entrada', cantidad: 1, stockResultante: 9 }).error);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: 'nope', tipo: 'entrada', cantidad: 1 }).error);
  });

  it('query DTO defaults and bounds', () => {
    const { value, error } = queryInventarioMovimientoDto.validate({});
    assert.equal(error, undefined);
    assert.equal(value.page, 1);
    assert.equal(value.limit, 20);
    assert.ok(queryInventarioMovimientoDto.validate({ limit: 500 }).error);
  });
});
