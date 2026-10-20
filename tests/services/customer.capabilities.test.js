/**
 * tests/services/customer.capabilities.test.js
 * tenant-capabilities-hybrid-mode, task 2.4 (service + controller). DB-free: model statics are stubbed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { customerService } from '../../src/services/customer.service.js';
import { customerController } from '../../src/controllers/customer.controller.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Servicios } from '../../src/models/servicios.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

const TENANT = 'hosp';
const ID = '507f1f77bcf86cd799439001';
const NO_EXEC = { executesServices: false, registersExternal: true };
const EXEC = { executesServices: true, registersExternal: false };

const payload = (extra = {}) => ({
  Razonsocial: 'Acme', Ciudad: 'Bogota', Departamento: 'Cundinamarca', Email: 'a@acme.com', Nit: 900,
  TelContacto: '3001234567', UserContacto: 'Ana Perez', ...extra,
});

function stubCreate() {
  const calls = { customer: [], sedes: [], servicios: [], uploads: 0 };
  Customer.create = async (d) => { calls.customer.push(d); return { _id: ID, ...d }; };
  Sedes.create = async (d) => { calls.sedes.push(d); return { _id: 'sede-1', ...d }; };
  Servicios.create = async (d) => { calls.servicios.push(d); return { _id: 'serv-1', ...d }; };
  return calls;
}

describe('customerService.create capability by kind', () => {
  const originalUpload = firebaseStorageService.uploadLogo;
  afterEach(() => {
    delete Customer.create; delete Sedes.create; delete Servicios.create;
    firebaseStorageService.uploadLogo = originalUpload;
  });

  it('kind=customer without executesServices is 403 CAPABILITY_DISABLED and stores nothing', async () => {
    const calls = stubCreate();
    await assert.rejects(() => customerService.create(payload({ kind: 'customer' }), TENANT, null, NO_EXEC), (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'CAPABILITY_DISABLED');
      return true;
    });
    assert.equal(calls.customer.length, 0);
  });

  it('a missing kind defaults to customer and is denied too', async () => {
    const calls = stubCreate();
    await assert.rejects(() => customerService.create(payload(), TENANT, null, NO_EXEC), (err) => err.code === 'CAPABILITY_DISABLED');
    assert.equal(calls.customer.length, 0);
  });

  it('the denial happens before any logo upload', async () => {
    stubCreate();
    let uploaded = false;
    firebaseStorageService.uploadLogo = async () => { uploaded = true; return 'https://x/logo.png'; };
    await assert.rejects(
      () => customerService.create(payload(), TENANT, { buffer: Buffer.from('x'), originalname: 'l.png', mimetype: 'image/png' }, NO_EXEC),
      (err) => err.code === 'CAPABILITY_DISABLED',
    );
    assert.equal(uploaded, false);
  });

  it('kind=provider is always allowed, even without executesServices', async () => {
    const calls = stubCreate();
    const out = await customerService.create(payload({ kind: 'provider' }), TENANT, null, NO_EXEC);
    assert.equal(out.kind, 'provider');
    assert.equal(calls.customer.length, 1);
    assert.equal(calls.sedes.length, 0);
  });

  it('kind=customer with executesServices keeps working', async () => {
    const calls = stubCreate();
    await customerService.create(payload(), TENANT, null, EXEC);
    assert.equal(calls.customer.length, 1);
    assert.equal(calls.sedes.length, 1);
    assert.equal(calls.servicios.length, 1);
  });

  it('without capabilities (legacy callers) it behaves as before', async () => {
    const calls = stubCreate();
    await customerService.create(payload(), TENANT);
    assert.equal(calls.customer.length, 1);
  });
});

describe('customerService.create validates the default-branch data first (spec: no orphan customer)', () => {
  afterEach(() => { delete Customer.create; delete Sedes.create; delete Servicios.create; });

  for (const field of ['TelContacto', 'UserContacto', 'Departamento']) {
    for (const bad of [undefined, '', '   ']) {
      it(`missing ${field} (${JSON.stringify(bad)}) -> 400 and no customer, branch or service is stored`, async () => {
        const calls = stubCreate();
        const data = payload();
        if (bad === undefined) delete data[field]; else data[field] = bad;
        await assert.rejects(() => customerService.create(data, TENANT, null, EXEC), (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'MISSING_BRANCH_DATA');
          assert.match(err.message, /sede principal/i);
          assert.ok(err.details.fields.includes(field));
          return true;
        });
        assert.equal(calls.customer.length, 0);
        assert.equal(calls.sedes.length, 0);
        assert.equal(calls.servicios.length, 0);
      });
    }
  }

  it('lists every missing field at once', async () => {
    stubCreate();
    const data = payload();
    delete data.TelContacto; delete data.UserContacto;
    await assert.rejects(() => customerService.create(data, TENANT), (err) => {
      assert.deepEqual(err.details.fields.sort(), ['TelContacto', 'UserContacto']);
      return true;
    });
  });

  it('providers do not need that data', async () => {
    const calls = stubCreate();
    const data = payload({ kind: 'provider' });
    delete data.TelContacto; delete data.UserContacto;
    await customerService.create(data, TENANT);
    assert.equal(calls.customer.length, 1);
  });
});

describe('customerService.delete capability by stored kind', () => {
  afterEach(() => { delete Customer.findOne; delete Customer.findOneAndUpdate; });

  function stubDelete(doc) {
    const state = { updated: false };
    Customer.findOne = async () => doc;
    Customer.findOneAndUpdate = async () => { state.updated = true; return { _id: ID }; };
    return state;
  }

  it('a kind=customer document is 403 without executesServices and nothing is deleted', async () => {
    const state = stubDelete({ _id: ID, kind: 'customer' });
    await assert.rejects(() => customerService.delete(ID, TENANT, NO_EXEC), (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'CAPABILITY_DISABLED');
      return true;
    });
    assert.equal(state.updated, false);
  });

  it('a legacy document without kind counts as customer', async () => {
    const state = stubDelete({ _id: ID });
    await assert.rejects(() => customerService.delete(ID, TENANT, NO_EXEC), (err) => err.code === 'CAPABILITY_DISABLED');
    assert.equal(state.updated, false);
  });

  it('a kind=provider document is always deletable', async () => {
    const state = stubDelete({ _id: ID, kind: 'provider' });
    await customerService.delete(ID, TENANT, NO_EXEC);
    assert.equal(state.updated, true);
  });

  it('a customer is deletable with executesServices', async () => {
    const state = stubDelete({ _id: ID, kind: 'customer' });
    await customerService.delete(ID, TENANT, EXEC);
    assert.equal(state.updated, true);
  });

  it('a missing document stays 404 (not 403) so nothing is revealed', async () => {
    stubDelete(null);
    await assert.rejects(() => customerService.delete(ID, TENANT, NO_EXEC), (err) => err.statusCode === 404);
  });
});

describe('customerController passes req.tenant.capabilities', () => {
  const orig = {
    create: customerService.create, delete: customerService.delete, update: customerService.update,
  };
  afterEach(() => {
    customerService.create = orig.create; customerService.delete = orig.delete; customerService.update = orig.update;
  });

  const resStub = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const req = (extra = {}) => ({
    tenantId: TENANT, tenant: { tenantId: TENANT, capabilities: NO_EXEC }, params: { id: ID }, body: payload(), ...extra,
  });

  it('create forwards the capabilities (4th argument) and the logo file', async () => {
    let args = null;
    customerService.create = async (...a) => { args = a; return { _id: ID }; };
    const res = resStub();
    await customerController.create(req({ file: { originalname: 'l.png' } }), res, (e) => { throw e; });
    assert.equal(args[1], TENANT);
    assert.equal(args[2].originalname, 'l.png');
    assert.deepEqual(args[3], NO_EXEC);
    assert.equal(res.statusCode, 201);
  });

  it('create surfaces the 403 through next()', async () => {
    customerService.create = orig.create;
    // Real service, nothing stubbed on the models: the capability check throws before any DB access.
    let err = null;
    await customerController.create(req({ body: { kind: 'customer' } }), resStub(), (e) => { err = e; });
    assert.equal(err.code, 'CAPABILITY_DISABLED');
  });

  it('delete forwards the capabilities (3rd argument)', async () => {
    let args = null;
    customerService.delete = async (...a) => { args = a; };
    await customerController.delete(req(), resStub(), (e) => { throw e; });
    assert.deepEqual(args, [ID, TENANT, NO_EXEC]);
  });

  it('update is not capability-gated: the organization client can always be edited', async () => {
    let args = null;
    customerService.update = async (...a) => { args = a; return { _id: ID }; };
    const res = resStub();
    await customerController.update(req({ body: { Razonsocial: 'Nuevo' } }), res, (e) => { throw e; });
    assert.equal(args.length >= 3, true);
    assert.equal(res.statusCode, 200);
  });
});
