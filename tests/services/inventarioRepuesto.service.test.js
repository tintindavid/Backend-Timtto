/**
 * inventario-stock tasks 2.2 - 2.4: catalogue service and DTOs. DB-free: model statics are stubbed with a tiny
 * in-memory collection that honours tenantId, _id, isDeleted and case-insensitive name regexes.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { inventarioRepuestoService } from '../../src/services/inventarioRepuesto.service.js';
import {
  createInventarioRepuestoDto,
  updateInventarioRepuestoDto,
  queryInventarioRepuestoDto,
} from '../../src/dtos/inventarioRepuestoDto.js';

const BASIC = { executesServices: true, usesInventoryBasic: true };
const ADVANCED = { executesServices: true, usesInventoryBasic: true, usesInventoryAdvanced: true };

let rows;
let lastListQuery;
const saved = {};

function matches(doc, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$or' || k === '$expr') continue;
    if (k === 'nombre' && v && v.$regex) {
      if (!new RegExp(v.$regex, v.$options).test(doc.nombre)) return false;
    } else if (k === '_id' && v && v.$ne !== undefined) {
      if (String(doc._id) === String(v.$ne)) return false;
    } else if (typeof v !== 'object' && String(doc[k]) !== String(v)) {
      return false;
    }
  }
  return true;
}

beforeEach(() => {
  rows = [];
  lastListQuery = null;
  let seq = 0;
  saved.create = InventarioRepuesto.create;
  saved.findOne = InventarioRepuesto.findOne;
  saved.find = InventarioRepuesto.find;
  saved.count = InventarioRepuesto.countDocuments;
  saved.fou = InventarioRepuesto.findOneAndUpdate;

  InventarioRepuesto.create = async (d) => {
    const doc = {
      _id: `i${++seq}`, tipo: 'repuesto', activo: true, isDeleted: false, ...d,
      toJSON() { const { toJSON, isDeleted, ...rest } = this; return { ...rest }; },
    };
    rows.push(doc);
    return doc;
  };
  InventarioRepuesto.findOne = (filter) => {
    const hit = rows.find((r) => !r.isDeleted && matches(r, filter));
    const res = Promise.resolve(hit ?? null);
    res.select = () => ({ lean: async () => hit ?? null });
    return res;
  };
  InventarioRepuesto.find = (filter) => {
    lastListQuery = filter;
    const out = rows.filter((r) => !r.isDeleted && matches(r, filter));
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => out.map((r) => ({ ...r })) };
    return chain;
  };
  InventarioRepuesto.countDocuments = async (filter) => rows.filter((r) => !r.isDeleted && matches(r, filter)).length;
  InventarioRepuesto.findOneAndUpdate = async (filter, update) => {
    const hit = rows.find((r) => !r.isDeleted && matches(r, filter));
    if (!hit) return null;
    Object.assign(hit, update.$set);
    return hit;
  };
});

afterEach(() => {
  InventarioRepuesto.create = saved.create;
  InventarioRepuesto.findOne = saved.findOne;
  InventarioRepuesto.find = saved.find;
  InventarioRepuesto.countDocuments = saved.count;
  InventarioRepuesto.findOneAndUpdate = saved.fou;
});

describe('inventario DTOs', () => {
  it('create requires nombre and tipo, rejects unknown tipo, stockActual and tenantId', () => {
    assert.equal(createInventarioRepuestoDto.validate({ nombre: 'Filtro', tipo: 'repuesto' }).error, undefined);
    assert.ok(createInventarioRepuestoDto.validate({ nombre: 'Filtro' }).error, 'tipo required');
    assert.ok(createInventarioRepuestoDto.validate({ nombre: 'Filtro', tipo: 'otro' }).error);
    assert.ok(createInventarioRepuestoDto.validate({ nombre: 'F', tipo: 'repuesto', stockActual: 5 }).error, 'stock only via movements');
    assert.ok(createInventarioRepuestoDto.validate({ nombre: 'F', tipo: 'repuesto', tenantId: 'x' }).error);
  });

  it('update needs at least one field and rejects stockActual', () => {
    assert.ok(updateInventarioRepuestoDto.validate({}).error);
    assert.ok(updateInventarioRepuestoDto.validate({ stockActual: 3 }).error);
    assert.equal(updateInventarioRepuestoDto.validate({ activo: false }).error, undefined);
  });

  it('query defaults to alphabetical order and accepts tipo / sortBy / order / stockBajo', () => {
    const { value, error } = queryInventarioRepuestoDto.validate({ tipo: 'accesorio', stockBajo: 'true' });
    assert.equal(error, undefined);
    assert.equal(value.sortBy, 'nombre');
    assert.equal(value.order, 'asc');
    assert.equal(value.stockBajo, true);
    assert.ok(queryInventarioRepuestoDto.validate({ sortBy: 'passwordHash' }).error);
    assert.ok(queryInventarioRepuestoDto.validate({ limit: 101 }).error);
  });
});

describe('inventarioRepuestoService (capabilities and tenant isolation)', () => {
  it('creates a basic item with stockActual 0 in the caller tenant, ignoring any tenantId/stock in data', async () => {
    const item = await inventarioRepuestoService.create({ nombre: 'Filtro HEPA', tipo: 'accesorio', tenantId: 'evil', stockActual: 99 }, 'tenant-a', BASIC);
    assert.equal(rows[0].tenantId, 'tenant-a');
    assert.equal(rows[0].stockActual, 0);
    assert.equal(item.tipo, 'accesorio');
    assert.equal(item.stockActual, undefined, 'basic level never exposes quantities');
  });

  it('rejects advanced fields without the capability: 403 CAPABILITY_DISABLED', async () => {
    for (const field of [{ stockMinimo: 2 }, { precio: 10 }, { unidad: 'u' }, { referencia: 'r' }, { descripcion: 'd' }]) {
      await assert.rejects(
        () => inventarioRepuestoService.create({ nombre: 'X', tipo: 'repuesto', ...field }, 'tenant-a', BASIC),
        (e) => e.statusCode === 403 && e.code === 'CAPABILITY_DISABLED',
      );
    }
    assert.equal(rows.length, 0);
    await assert.rejects(
      () => inventarioRepuestoService.update('i1', { precio: 5 }, 'tenant-a', BASIC),
      (e) => e.code === 'CAPABILITY_DISABLED',
    );
  });

  it('advanced tenants can store and read the full record', async () => {
    const item = await inventarioRepuestoService.create({ nombre: 'Sensor', tipo: 'repuesto', precio: 10, stockMinimo: 2 }, 'tenant-a', ADVANCED);
    assert.equal(item.precio, 10);
    assert.equal(item.stockActual, 0);
  });

  it('duplicate name (case-insensitive) in the same tenant is 409; another tenant may reuse it', async () => {
    await inventarioRepuestoService.create({ nombre: 'Sensor SpO2', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await assert.rejects(
      () => inventarioRepuestoService.create({ nombre: 'sensor spo2', tipo: 'repuesto' }, 'tenant-a', BASIC),
      (e) => e.statusCode === 409,
    );
    await inventarioRepuestoService.create({ nombre: 'Sensor SpO2', tipo: 'repuesto' }, 'tenant-b', BASIC);
    assert.equal(rows.length, 2);
  });

  it('name regex metacharacters are escaped (a name like "a.c" does not clash with "abc")', async () => {
    await inventarioRepuestoService.create({ nombre: 'abc', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await inventarioRepuestoService.create({ nombre: 'a.c', tipo: 'repuesto' }, 'tenant-a', BASIC);
    assert.equal(rows.length, 2);
  });

  it('renaming onto another item name is 409 but keeping its own name is fine', async () => {
    const a = await inventarioRepuestoService.create({ nombre: 'Uno', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await inventarioRepuestoService.create({ nombre: 'Dos', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await assert.rejects(() => inventarioRepuestoService.update(a._id, { nombre: 'dos' }, 'tenant-a', BASIC), (e) => e.statusCode === 409);
    const ok = await inventarioRepuestoService.update(a._id, { nombre: 'UNO' }, 'tenant-a', BASIC);
    assert.equal(ok.nombre, 'UNO');
  });

  it('IDOR: getById / update / delete of another tenant item is 404', async () => {
    const a = await inventarioRepuestoService.create({ nombre: 'Privado', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await assert.rejects(() => inventarioRepuestoService.getById(a._id, 'tenant-b', BASIC), (e) => e.statusCode === 404);
    await assert.rejects(() => inventarioRepuestoService.update(a._id, { activo: false }, 'tenant-b', BASIC), (e) => e.statusCode === 404);
    await assert.rejects(() => inventarioRepuestoService.delete(a._id, 'tenant-b'), (e) => e.statusCode === 404);
    assert.equal(rows[0].isDeleted, false);
  });

  it('delete is a soft delete', async () => {
    const a = await inventarioRepuestoService.create({ nombre: 'Borrar', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await inventarioRepuestoService.delete(a._id, 'tenant-a');
    assert.equal(rows[0].isDeleted, true);
    assert.ok(rows[0].deletedAt instanceof Date);
  });

  it('list is tenant scoped, escapes search and hides advanced fields / ignores stockBajo for basic tenants', async () => {
    await inventarioRepuestoService.create({ nombre: 'A', tipo: 'repuesto' }, 'tenant-a', BASIC);
    await inventarioRepuestoService.create({ nombre: 'B', tipo: 'repuesto' }, 'tenant-b', BASIC);
    const res = await inventarioRepuestoService.list({ stockBajo: true }, { search: '.*', sortBy: 'precio' }, 'tenant-a', BASIC);
    assert.equal(lastListQuery.tenantId, 'tenant-a');
    assert.equal(lastListQuery.$expr, undefined, 'stockBajo ignored without advanced');
    assert.equal(lastListQuery.$or[0].nombre.source, '\\.\\*');
    assert.equal(lastListQuery.$or.length, 1, 'basic searches by name only');
    assert.ok(res.data.every((r) => r.tenantId === 'tenant-a'));
    assert.ok(res.data.every((r) => r.stockActual === undefined && r.precio === undefined));
  });

  it('advanced list supports stockBajo as stockActual <= stockMinimo and returns quantities', async () => {
    await inventarioRepuestoService.create({ nombre: 'A', tipo: 'repuesto', stockMinimo: 1 }, 'tenant-a', ADVANCED);
    const res = await inventarioRepuestoService.list({ stockBajo: true, tipo: 'repuesto' }, {}, 'tenant-a', ADVANCED);
    assert.deepEqual(lastListQuery.$expr, { $lte: ['$stockActual', '$stockMinimo'] });
    assert.equal(lastListQuery.tipo, 'repuesto');
    assert.equal(res.data[0].stockActual, 0);
    assert.equal(res.pagination.total, 1);
  });
});
