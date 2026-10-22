/**
 * tests/scripts/backfill-inventario-stock.test.js
 * inventario-stock, task 4.2. DB-free: model statics are stubbed with a tiny in-memory store.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { backfillInventarioStock, planGrantsInventory } from '../../scripts/2026-10-21-backfill-inventario-stock.js';

let items;
let tenants;
let updates;
const saved = {};

const hasInventarioPlan = (t) => /inventario/i.test(t.plan || '');
const needsFlags = (t) => hasInventarioPlan(t) && !(t.capabilities?.usesInventoryBasic === true && t.capabilities?.usesInventoryAdvanced === true);

beforeEach(() => {
  items = [
    { _id: 1 },
    { _id: 2, tipo: 'accesorio', activo: false },
    { _id: 3, isDeleted: true },
  ];
  tenants = [
    { _id: 'a', plan: 'premium inventario' },
    { _id: 'b', plan: 'free', capabilities: { executesServices: true } },
    { _id: 'd', plan: 'Plan sin inventario' },
    { _id: 'e', plan: 'Básico, no incluye Inventario' },
    { _id: 'f', plan: 'inventarios-x' },
    { _id: 'c', plan: 'Inventario', capabilities: { usesInventoryBasic: true, usesInventoryAdvanced: true } },
  ];
  updates = [];
  Object.assign(saved, {
    invCount: InventarioRepuesto.countDocuments,
    invUpdate: InventarioRepuesto.updateMany,
    tFind: Tenant.find,
    tUpdate: Tenant.updateMany,
  });

  const opts = (value) => ({ setOptions: (o) => { assert.equal(o.includeDeleted, true); return Promise.resolve(value()); } });

  InventarioRepuesto.countDocuments = (f) => opts(() => items.filter((i) => (f.tipo ? i.tipo === undefined : i.activo === undefined)).length);
  InventarioRepuesto.updateMany = (f, u) => opts(() => {
    updates.push({ model: 'item', f, u });
    let n = 0;
    for (const i of items) {
      const [key] = Object.keys(u.$set);
      if (i[key] === undefined) { i[key] = u.$set[key]; n += 1; }
    }
    return { modifiedCount: n };
  });
  Tenant.find = (f) => {
    assert.equal(f.plan.$regex, 'inventario');
    const q = { select: () => q, setOptions: () => q, lean: async () => tenants.filter(needsFlags) };
    return q;
  };
  Tenant.updateMany = (f, u) => opts(() => {
    updates.push({ model: 'tenant', f, u });
    let n = 0;
    for (const t of tenants.filter((x) => f._id.$in.includes(x._id))) {
      t.capabilities = { ...(t.capabilities || {}), usesInventoryBasic: true, usesInventoryAdvanced: true };
      n += 1;
    }
    return { modifiedCount: n };
  });
});

afterEach(() => {
  InventarioRepuesto.countDocuments = saved.invCount;
  InventarioRepuesto.updateMany = saved.invUpdate;
  Tenant.find = saved.tFind;
  Tenant.updateMany = saved.tUpdate;
});

describe('backfillInventarioStock', () => {
  it('dry run counts but writes nothing', async () => {
    const r = await backfillInventarioStock({ dryRun: true });
    assert.equal(r.itemsWithoutTipo, 2);
    assert.equal(r.itemsWithoutActivo, 2);
    assert.equal(r.tenantsToEnable, 1);
    assert.equal(updates.length, 0);
    assert.equal(r.dryRun, true);
  });

  it('defaults tipo and activo and enables both flags only for plans that include "inventario"', async () => {
    const r = await backfillInventarioStock();
    assert.deepEqual(items.map((i) => i.tipo), ['repuesto', 'accesorio', 'repuesto'], 'soft-deleted items included, existing tipo kept');
    assert.deepEqual(items.map((i) => i.activo), [true, false, true], 'existing activo kept');
    assert.deepEqual(tenants[0].capabilities, { usesInventoryBasic: true, usesInventoryAdvanced: true });
    assert.deepEqual(tenants[1].capabilities, { executesServices: true }, 'free plan untouched');
    for (const i of [2, 3, 4]) assert.equal(tenants[i].capabilities, undefined, 'negated plan untouched');
    assert.equal(r.tenantsUpdated, 1);
  });

  it('writes only the two flags with dot notation and never touches plan', async () => {
    await backfillInventarioStock();
    const t = updates.find((u) => u.model === 'tenant');
    assert.deepEqual(t.u, { $set: { 'capabilities.usesInventoryBasic': true, 'capabilities.usesInventoryAdvanced': true } });
    assert.deepEqual(t.f, { _id: { $in: ['a'] } }, 'negated / partial-word plans are not matched');
    const stockTouched = updates.some((u) => u.model === 'item' && 'stockActual' in u.u.$set);
    assert.equal(stockTouched, false);
  });

  it('is idempotent: the second run changes nothing', async () => {
    await backfillInventarioStock();
    const before = JSON.stringify({ items, tenants });
    updates = [];
    const r2 = await backfillInventarioStock();
    assert.equal(updates.length, 0);
    assert.equal(r2.itemsTipoUpdated + r2.itemsActivoUpdated + r2.tenantsUpdated, 0);
    assert.equal(JSON.stringify({ items, tenants }), before);
  });
});

describe('planGrantsInventory', () => {
  it('matches only plans that grant inventory', () => {
    assert.equal(planGrantsInventory('premium inventario'), true);
    assert.equal(planGrantsInventory('Inventario'), true);
    assert.equal(planGrantsInventory('pro, inventario'), true);
    assert.equal(planGrantsInventory('sin inventario'), false);
    assert.equal(planGrantsInventory('No incluye Inventario'), false);
    assert.equal(planGrantsInventory('inventarios'), false);
    assert.equal(planGrantsInventory('preinventario'), false);
    assert.equal(planGrantsInventory(undefined), false);
  });
});
