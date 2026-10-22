import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { repuestosService } from '../src/services/repuestos.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { Customer } from '../src/models/customer.model.js';
import { InventarioRepuesto } from '../src/models/inventarioRepuesto.model.js';
import { createInventarioMovimientoDto } from '../src/dtos/inventarioMovimientoDto.js';

const ITEM = '507f1f77bcf86cd799439021';
const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

// Fake catalog honouring tenantId + soft delete (the real model hook hides deleted docs).
function stubCatalog(rows) {
  stub(InventarioRepuesto, 'findOne', (f) => {
    const row = rows.find((r) => String(r._id) === String(f._id) && r.tenantId === f.tenantId && !r.isDeleted);
    return { select: () => ({ lean: async () => row || null }) };
  });
}

describe('Repuestos InventarioItemId validation', () => {
  it('create: rejects foreign-tenant, nonexistent and soft-deleted items with INVENTARIO_ITEM_NOT_FOUND', async () => {
    stubCatalog([
      { _id: ITEM, tenantId: 'tenant-b' },
      { _id: '507f1f77bcf86cd799439022', tenantId: 'tenant-a', isDeleted: true },
    ]);
    let created = 0;
    stub(Customer, 'findOne', () => ({ lean: async () => ({ kind: 'customer' }) }));
    stub(Repuestos, 'create', async () => { created += 1; return { _id: 'x' }; });
    for (const id of [ITEM, '507f1f77bcf86cd799439022', '507f1f77bcf86cd799439023']) {
      await assert.rejects(
        () => repuestosService.create({ nombre: 'x', InventarioItemId: id }, 'tenant-a'),
        (e) => e.statusCode === 400 && e.code === 'INVENTARIO_ITEM_NOT_FOUND',
      );
    }
    assert.equal(created, 0);
  });

  it('create: accepts an item of the same tenant, and skips the check when the field is absent', async () => {
    stubCatalog([{ _id: ITEM, tenantId: 'tenant-a' }]);
    let lookups = 0;
    const orig = InventarioRepuesto.findOne;
    InventarioRepuesto.findOne = (...a) => { lookups += 1; return orig(...a); };
    stub(Repuestos, 'create', async (d) => ({ _id: 'x', ...d }));
    const ok = await repuestosService.create({ nombre: 'x', InventarioItemId: ITEM }, 'tenant-a');
    assert.equal(ok.InventarioItemId, ITEM);
    await repuestosService.create({ nombre: 'y' }, 'tenant-a');
    assert.equal(lookups, 1);
  });

  it('update: validates only when the item changes; rejects foreign ids', async () => {
    stubCatalog([{ _id: ITEM, tenantId: 'tenant-b' }]);
    let updated = 0;
    const current = { tenantId: 'tenant-a', InventarioItemId: '507f1f77bcf86cd799439030' };
    stub(Repuestos, 'findById', () => ({ lean: async () => current }));
    stub(Repuestos, 'findByIdAndUpdate', async () => { updated += 1; return { _id: 'r', tenantId: 'tenant-a' }; });
    await assert.rejects(
      () => repuestosService.update('r', { InventarioItemId: ITEM }),
      (e) => e.code === 'INVENTARIO_ITEM_NOT_FOUND',
    );
    assert.equal(updated, 0);
    // unchanged item id: no lookup, update goes through even if the item was later deleted
    await repuestosService.update('r', { InventarioItemId: current.InventarioItemId });
    assert.equal(updated, 1);
  });
});

describe('createInventarioMovimientoDto cantidad bounds', () => {
  const base = { itemId: ITEM, tipo: 'entrada' };
  it('keeps decimals but rejects absurd magnitudes', () => {
    assert.equal(createInventarioMovimientoDto.validate({ ...base, cantidad: 1.5 }).error, undefined);
    assert.ok(createInventarioMovimientoDto.validate({ ...base, cantidad: 1e12 }).error);
    assert.ok(createInventarioMovimientoDto.validate({ itemId: ITEM, tipo: 'ajuste', cantidad: -1e12, motivo: 'x' }).error);
  });
});
