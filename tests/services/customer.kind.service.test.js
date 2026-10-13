/**
 * tests/services/customer.kind.service.test.js
 * terceros-customers-providers, tasks 1.3 / 3.3-3.5 / 5.1. DB-free: model statics are stubbed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { customerService } from '../../src/services/customer.service.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Servicios } from '../../src/models/servicios.model.js';

const TENANT = 'tenant-a';
const ID = '507f1f77bcf86cd799439001';

const payload = (extra = {}) => ({
  Razonsocial: 'Acme', Ciudad: 'Bogota', Departamento: 'Cundinamarca', Email: 'a@acme.com', Nit: 900, ...extra,
});

function stubCreate() {
  const calls = { customer: [], sedes: [], servicios: [] };
  Customer.create = async (d) => { calls.customer.push(d); return { _id: ID, ...d }; };
  Sedes.create = async (d) => { calls.sedes.push(d); return { _id: 'sede-1', ...d }; };
  Servicios.create = async (d) => { calls.servicios.push(d); return { _id: 'serv-1', ...d }; };
  return calls;
}

function stubList() {
  const captured = {};
  Customer.find = (q) => {
    captured.find = q;
    return { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: () => Promise.resolve([]) };
  };
  Customer.countDocuments = async (q) => { captured.count = q; return 0; };
  return captured;
}

describe('customerService.create kind', () => {
  afterEach(() => {
    delete Customer.create; delete Sedes.create; delete Servicios.create;
  });

  it('defaults to customer and creates the default Sede and Servicio', async () => {
    const calls = stubCreate();
    await customerService.create(payload(), TENANT);
    assert.equal(calls.customer[0].kind, 'customer');
    assert.equal(calls.sedes.length, 1);
    assert.equal(calls.servicios.length, 1);
  });

  it('provider: stores kind provider and creates no Sede/Servicio', async () => {
    const calls = stubCreate();
    await customerService.create(payload({ kind: 'provider' }), TENANT);
    assert.equal(calls.customer[0].kind, 'provider');
    assert.equal(calls.customer[0].tenantId, TENANT);
    assert.equal(calls.sedes.length, 0);
    assert.equal(calls.servicios.length, 0);
  });

  it('rejects an unknown kind with 400 and stores nothing', async () => {
    const calls = stubCreate();
    await assert.rejects(() => customerService.create(payload({ kind: 'supplier' }), TENANT), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
    assert.equal(calls.customer.length, 0);
  });
});

describe('customerService.update kind immutability', () => {
  afterEach(() => { delete Customer.findOne; delete Customer.findOneAndUpdate; });

  it('removes kind from the $set payload', async () => {
    Customer.findOne = async () => ({ _id: ID, kind: 'customer' });
    let update = null;
    Customer.findOneAndUpdate = async (_f, u) => { update = u; return { _id: ID, kind: 'customer' }; };
    await customerService.update(ID, { Razonsocial: 'New', kind: 'provider' }, TENANT);
    assert.equal(update.$set.Razonsocial, 'New');
    assert.equal('kind' in update.$set, false);
  });
});

describe('customerService.list kind filter', () => {
  afterEach(() => { delete Customer.find; delete Customer.countDocuments; });

  it('default (no kind) excludes providers, legacy docs included via $ne', async () => {
    const c = stubList();
    await customerService.list({}, {}, TENANT);
    assert.deepEqual(c.find.kind, { $ne: 'provider' });
    assert.equal(c.find.tenantId, TENANT);
    assert.equal(c.find.isDeleted, false);
    assert.deepEqual(c.count.kind, { $ne: 'provider' });
  });

  it('kind=customer behaves like the default', async () => {
    const c = stubList();
    await customerService.list({ kind: 'customer' }, {}, TENANT);
    assert.deepEqual(c.find.kind, { $ne: 'provider' });
  });

  it('kind=provider returns only providers', async () => {
    const c = stubList();
    await customerService.list({ kind: 'provider' }, {}, TENANT);
    assert.equal(c.find.kind, 'provider');
    assert.equal(c.find.tenantId, TENANT);
  });

  it('kind=all applies no kind filter but keeps tenant and soft-delete', async () => {
    const c = stubList();
    await customerService.list({ kind: 'all' }, {}, TENANT);
    assert.equal('kind' in c.find, false);
    assert.equal(c.find.tenantId, TENANT);
    assert.equal(c.find.isDeleted, false);
  });

  it('rejects an unknown kind with 400', async () => {
    stubList();
    await assert.rejects(() => customerService.list({ kind: 'x' }, {}, TENANT), (err) => err.statusCode === 400);
  });
});

describe('customerService.exportCsv', () => {
  afterEach(() => { delete Customer.find; });

  it('excludes providers', async () => {
    let query = null;
    Customer.find = (q) => {
      query = q;
      return { sort() { return this; }, select() { return this; }, lean: () => Promise.resolve([]) };
    };
    await customerService.exportCsv({}, TENANT);
    assert.deepEqual(query.kind, { $ne: 'provider' });
    assert.equal(query.tenantId, TENANT);
  });
});
