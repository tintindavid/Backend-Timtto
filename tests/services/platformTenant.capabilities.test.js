/**
 * tests/services/platformTenant.capabilities.test.js
 * tenant-capabilities-hybrid-mode, tasks 2.5 (PATCH capabilities) and 2.6 (create with a type).
 * DB-free: Mongoose statics and mongoose.startSession are stubbed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { PlatformTenantService } from '../../src/services/platformTenant.service.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Servicios } from '../../src/models/servicios.model.js';
import { emailService } from '../../src/services/external/email.service.js';

const TENANT_ID_MONGO = '507f1f77bcf86cd799439011';
const C1 = '507f1f77bcf86cd799439021';
const C2 = '507f1f77bcf86cd799439022';
const C3 = '507f1f77bcf86cd799439023';

const completeTenant = (extra = {}) => ({
  _id: TENANT_ID_MONGO,
  tenantId: 'acme',
  name: 'Clinica Acme',
  nit: '900123456-7',
  ciudad: 'Bogota',
  departamento: 'Cundinamarca',
  email: 'info@acme.com',
  telefono: '6011234567',
  direccion: 'Calle 1 # 2-3',
  status: 'active',
  organizationCustomerId: null,
  ...extra,
});

/** Chainable, awaitable query stand-in. */
const chain = (value) => {
  const q = {
    select: () => q, sort: () => q, setOptions: () => q, session: () => q, limit: () => q,
    lean: () => Promise.resolve(value),
    then: (res, rej) => Promise.resolve(value).then(res, rej),
  };
  return q;
};

const saved = {};
const KEEP = [
  [Tenant, ['findById', 'findOne', 'create', 'findByIdAndUpdate', 'updateOne']],
  [User, ['findOne', 'create', 'updateMany']],
  [Role, ['create', 'updateMany']],
  [Customer, ['find', 'findOne', 'create', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany']],
  [Sedes, ['create', 'updateOne', 'deleteOne']],
  [Servicios, ['create', 'updateOne', 'deleteOne']],
];

let log;
let sessionState;

function stubSession({ unsupported = false } = {}) {
  sessionState = { transactions: 0, ended: 0 };
  mongoose.startSession = async () => ({
    withTransaction: async (fn) => {
      if (unsupported) {
        const err = new Error('Transaction numbers are only allowed on a replica set member or mongos');
        err.code = 20;
        throw err;
      }
      sessionState.transactions += 1;
      return fn();
    },
    endSession: async () => { sessionState.ended += 1; },
  });
}

beforeEach(() => {
  saved.startSession = mongoose.startSession;
  saved.sendWelcomeEmail = emailService.sendWelcomeEmail;
  for (const [model, names] of KEEP) {
    saved[model.modelName] = Object.fromEntries(names.map((n) => [n, Object.getOwnPropertyDescriptor(model, n)]));
  }
  log = { customers: [], sedes: [], servicios: [], tenantCreates: [], tenantUpdates: [], roles: [], users: [], softDeletes: [], hardDeletes: 0 };
  emailService.sendWelcomeEmail = async () => ({ sent: false });
  stubSession();

  let n = 0;
  const idFor = (prefix) => `${prefix}${(n += 1)}`.padEnd(24, '0');
  const made = (prefix) => (doc, _opts) => {
    const one = (d) => ({ ...d, _id: d._id ?? idFor(prefix), toJSON() { return { ...this, toJSON: undefined }; } });
    return Array.isArray(doc) ? Promise.resolve(doc.map(one)) : Promise.resolve(one(doc));
  };
  Tenant.create = (doc, opts) => { log.tenantCreates.push({ doc: Array.isArray(doc) ? doc[0] : doc, opts }); return made('a')(doc, opts); };
  Tenant.findOne = () => chain(null);
  Tenant.updateOne = async (f, u) => { log.softDeletes.push({ model: 'Tenant', f, u }); return {}; };
  Role.create = made('b');
  User.create = made('c');
  User.updateMany = async (f, u) => { log.softDeletes.push({ model: 'User', f, u }); return {}; };
  Role.updateMany = async (f, u) => { log.softDeletes.push({ model: 'Role', f, u }); return {}; };
  Customer.create = (doc, opts) => { log.customers.push({ doc: Array.isArray(doc) ? doc[0] : doc, opts }); return made('d')(doc, opts); };
  Sedes.create = (doc, opts) => { log.sedes.push({ doc: Array.isArray(doc) ? doc[0] : doc, opts }); return made('e')(doc, opts); };
  Servicios.create = (doc, opts) => { log.servicios.push({ doc: Array.isArray(doc) ? doc[0] : doc, opts }); return made('f')(doc, opts); };
  Customer.updateOne = async (f, u) => { log.softDeletes.push({ model: 'Customer', f, u }); return {}; };
  Sedes.updateOne = async (f, u) => { log.softDeletes.push({ model: 'Sedes', f, u }); return {}; };
  Servicios.updateOne = async (f, u) => { log.softDeletes.push({ model: 'Servicios', f, u }); return {}; };
  for (const m of [Customer, Sedes, Servicios]) {
    m.deleteOne = async () => { log.hardDeletes += 1; };
  }
  Customer.deleteMany = async () => { log.hardDeletes += 1; };
  Customer.updateMany = async () => { log.hardDeletes += 1; };
});

afterEach(() => {
  mongoose.startSession = saved.startSession;
  emailService.sendWelcomeEmail = saved.sendWelcomeEmail;
  for (const [model, names] of KEEP) {
    for (const n of names) {
      const d = saved[model.modelName][n];
      if (d) Object.defineProperty(model, n, d); else delete model[n];
    }
  }
});

const adminData = { email: 'admin@acme.com', firstName: 'Ana', lastName: 'Perez', phone: '3001234567' };

describe('PlatformTenantService.createWithAdmin with a type', () => {
  const clientInput = (tenantExtra = {}) => ({
    type: 'client',
    tenant: {
      tenantId: 'acme', name: 'Clinica Acme', nit: '900123456-7', ciudad: 'Bogota', departamento: 'Cundinamarca',
      email: 'info@acme.com', telefono: '6011234567', direccion: 'Calle 1 # 2-3', ...tenantExtra,
    },
    admin: adminData,
  });

  for (const mode of ['transaction', 'compensating']) {
    describe(`client tenant (${mode} path)`, () => {
      beforeEach(() => { stubSession({ unsupported: mode === 'compensating' }); });

      it('creates the organization client without logo, with its default branch and service', async () => {
        const out = await PlatformTenantService.createWithAdmin(clientInput());
        const tenantDoc = log.tenantCreates[0].doc;
        assert.deepEqual(tenantDoc.capabilities, { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });

        assert.equal(log.customers.length, 1);
        const c = log.customers[0].doc;
        assert.equal(c.tenantId, 'acme');
        assert.equal(c.Razonsocial, 'Clinica Acme');
        assert.equal(c.Nit, 900123456);
        assert.equal(typeof c.Nit, 'number');
        assert.equal(c.Ciudad, 'Bogota');
        assert.equal(c.Departamento, 'Cundinamarca');
        assert.equal(c.Email, 'info@acme.com');
        assert.equal(c.TelContacto, '6011234567');
        assert.equal(c.UserContacto, 'Ana Perez');
        assert.equal(c.Direccion, 'Calle 1 # 2-3');
        assert.equal(c.kind, 'customer');
        assert.equal('Logo' in c, false, 'the organization client has no logo');

        assert.equal(log.sedes.length, 1);
        assert.equal(log.sedes[0].doc.nombreSede, 'Principal');
        assert.equal(log.sedes[0].doc.tenantId, 'acme');
        assert.equal(String(log.sedes[0].doc.Cliente), String(c._id));
        assert.equal(log.sedes[0].doc.contact, 'Ana Perez');
        assert.equal(log.sedes[0].doc.telefono, '6011234567');
        assert.equal(log.sedes[0].doc.departamento, 'Cundinamarca');
        assert.equal(log.servicios.length, 1);
        assert.equal(log.servicios[0].doc.nombre, 'Principal');
        assert.equal(String(log.servicios[0].doc.Cliente), String(c._id));

        assert.equal(String(tenantDoc.organizationCustomerId), String(c._id), 'tenant stores the organization client id');
        assert.equal(String(out.tenant.organizationCustomerId), String(c._id));
        assert.equal(mode === 'transaction' ? sessionState.transactions : 0, mode === 'transaction' ? 1 : 0);
      });

      it('uses the session for every write only on the transactional path', async () => {
        await PlatformTenantService.createWithAdmin(clientInput());
        const withSession = mode === 'transaction';
        for (const entry of [...log.customers, ...log.sedes, ...log.servicios]) {
          assert.equal(Boolean(entry.opts?.session), withSession);
        }
      });
    });
  }

  it('an explicit capabilities object works like the preset', async () => {
    const input = clientInput();
    delete input.type;
    input.capabilities = { executesServices: false, registersExternal: true };
    await PlatformTenantService.createWithAdmin(input);
    assert.equal(log.customers.length, 1);
  });

  it('a hybrid tenant executes services: no organization client is created', async () => {
    const input = clientInput();
    input.type = 'hybrid';
    await PlatformTenantService.createWithAdmin(input);
    assert.deepEqual(log.tenantCreates[0].doc.capabilities, { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(log.customers.length, 0);
  });

  it('provider (no type): unchanged, no customer, default capabilities', async () => {
    const input = clientInput();
    delete input.type;
    await PlatformTenantService.createWithAdmin(input);
    assert.deepEqual(log.tenantCreates[0].doc.capabilities, { executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(log.customers.length, 0);
    assert.equal(log.sedes.length, 0);
    assert.equal('organizationCustomerId' in log.tenantCreates[0].doc && log.tenantCreates[0].doc.organizationCustomerId != null, false);
  });

  it('missing organization data is 400 and NOTHING is created (no tenant, admin, role or customer)', async () => {
    for (const missing of ['nit', 'telefono', 'ciudad', 'departamento', 'email']) {
      const input = clientInput();
      delete input.tenant[missing];
      await assert.rejects(() => PlatformTenantService.createWithAdmin(input), (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'TENANT_DATA_INCOMPLETE');
        return true;
      });
    }
    assert.equal(log.tenantCreates.length, 0);
    assert.equal(log.customers.length, 0);
  });

  it('a NIT without digits is rejected before anything is created', async () => {
    await assert.rejects(() => PlatformTenantService.createWithAdmin(clientInput({ nit: '-7' })), (err) => err.statusCode === 400);
    assert.equal(log.tenantCreates.length, 0);
  });

  it('a NIT that cannot be stored exactly as a Number is rejected before anything is created', async () => {
    await assert.rejects(() => PlatformTenantService.createWithAdmin(clientInput({ nit: '123456789012345678901-7' })), (err) => err.statusCode === 400);
    assert.equal(log.tenantCreates.length, 0);
  });

  it('both flags false is rejected', async () => {
    const input = clientInput();
    delete input.type;
    input.capabilities = { executesServices: false, registersExternal: false };
    await assert.rejects(() => PlatformTenantService.createWithAdmin(input), (err) => err.statusCode === 400);
    assert.equal(log.tenantCreates.length, 0);
  });

  it('compensating path: a failure while creating the branch soft-deletes tenant and customer, never hard-deletes', async () => {
    stubSession({ unsupported: true });
    Sedes.create = async () => { throw new Error('boom'); };
    await assert.rejects(() => PlatformTenantService.createWithAdmin(clientInput()), /boom/);
    const models = log.softDeletes.map((s) => s.model);
    assert.ok(models.includes('Tenant'));
    assert.ok(models.includes('Customer'));
    // the bootstrap role and admin created for the failed tenant must not stay active
    assert.ok(models.includes('User'));
    assert.ok(models.includes('Role'));
    for (const s of log.softDeletes) assert.equal(s.u.$set.isDeleted, true);
    assert.equal(log.hardDeletes, 0);
  });

  it('transactional path: a failure propagates and the transaction aborts (nothing else to clean)', async () => {
    Servicios.create = async () => { throw new Error('boom'); };
    await assert.rejects(() => PlatformTenantService.createWithAdmin(clientInput()), /boom/);
    assert.equal(log.softDeletes.length, 0);
  });
});

describe('PlatformTenantService.updateCapabilities', () => {
  let tenant;
  let tenantUpdates;
  let customers;
  let orgLookup;

  beforeEach(() => {
    tenant = completeTenant();
    tenantUpdates = [];
    customers = [];
    orgLookup = {};
    Tenant.findById = () => chain(tenant);
    Tenant.findByIdAndUpdate = (id, update) => {
      tenantUpdates.push({ id, update });
      const set = update.$set;
      tenant = { ...tenant, ...set };
      return chain(tenant);
    };
    Customer.find = () => chain(customers);
    Customer.findOne = (filter) => chain(orgLookup[String(filter._id)] ?? null);
    User.findOne = () => chain({ firstName: 'Ana', lastName: 'Perez' });
  });

  it('applies a preset', async () => {
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'hybrid' }, 'actor1');
    assert.deepEqual(out.capabilities, { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(out.type, 'hybrid');
    assert.deepEqual(tenantUpdates[0].update.$set.capabilities, { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(log.customers.length, 0, 'keeping executesServices needs no organization client');
  });

  it('merges partial flags over the stored ones', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: false } });
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { registersExternal: true }, 'actor1');
    assert.deepEqual(out.capabilities, { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
  });

  it('turns the QR module on without touching the other flags, the type or the organization client', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: false } });
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { usesQrs: true }, 'actor1');
    assert.deepEqual(out.capabilities, { executesServices: true, registersExternal: false, usesQrs: true, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(out.type, 'provider', 'usesQrs takes no part in the derived type');
    assert.deepEqual(tenantUpdates[0].update.$set.capabilities, { executesServices: true, registersExternal: false, usesQrs: true, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(log.customers.length, 0);
  });

  it('a preset keeps the QR module as it was', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: false, usesQrs: true } });
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'hybrid' }, 'actor1');
    assert.equal(out.capabilities.usesQrs, true);
  });

  it('turns the quick load on together with "Servicios de terceros", audit-ready before/after, type hybrid', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: false } });
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { registersExternal: true, scheduleQuickLoad: true }, 'actor1');
    assert.deepEqual(out.capabilities, { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: true, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(out.type, 'hybrid');
    assert.deepEqual(tenantUpdates[0].update.$set.capabilities, { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: true, usesInventoryBasic: false, usesInventoryAdvanced: false });
  });

  it('turning the quick load on without the module is 400 and nothing is written', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: false } });
    await assert.rejects(() => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { scheduleQuickLoad: true }, 'a'), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'INVALID_CAPABILITIES');
      return true;
    });
    assert.equal(tenantUpdates.length, 0);
  });

  it('turning the module off while the quick load is on is 400; turning both off works', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: true, scheduleQuickLoad: true } });
    await assert.rejects(() => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { registersExternal: false }, 'a'), (err) => err.code === 'INVALID_CAPABILITIES');
    assert.equal(tenantUpdates.length, 0);
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { registersExternal: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false }, 'a');
    assert.deepEqual(out.capabilities, { executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
  });

  it('a preset keeps the quick load as it was', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: true, scheduleQuickLoad: true } });
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a');
    assert.equal(out.capabilities.scheduleQuickLoad, true);
  });

  it('both flags false is 400 and nothing is written', async () => {
    tenant = completeTenant({ capabilities: { executesServices: true, registersExternal: false } });
    await assert.rejects(() => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { executesServices: false }, 'a'), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'INVALID_CAPABILITIES');
      return true;
    });
    assert.equal(tenantUpdates.length, 0);
    assert.equal(log.customers.length, 0);
  });

  it('404 for an unknown tenant', async () => {
    Tenant.findById = () => chain(null);
    await assert.rejects(() => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a'), (err) => err.statusCode === 404);
  });

  it('client with no existing client: creates the organization client from the tenant data (with branch and service)', async () => {
    customers = [];
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a');
    assert.equal(log.customers.length, 1);
    const c = log.customers[0].doc;
    assert.equal(c.Razonsocial, 'Clinica Acme');
    assert.equal(c.Nit, 900123456);
    assert.equal(c.UserContacto, 'Ana Perez', 'contact is the tenant admin');
    assert.equal('Logo' in c, false);
    assert.equal(log.sedes.length, 1);
    assert.equal(log.servicios.length, 1);
    assert.equal(out.organizationCustomerCreated, true);
    assert.equal(String(out.organizationCustomerId), String(c._id));
    assert.equal(String(tenantUpdates[0].update.$set.organizationCustomerId), String(c._id));
    assert.deepEqual(out.capabilities, { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(out.type, 'client');
  });

  it('creation without a transaction (standalone MongoDB) works too', async () => {
    stubSession({ unsupported: true });
    await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a');
    assert.equal(log.customers.length, 1);
    assert.equal(tenantUpdates.length, 1);
  });

  it('no existing client and incomplete tenant data: 400 TENANT_DATA_INCOMPLETE, nothing is written', async () => {
    tenant = completeTenant({ telefono: null });
    await assert.rejects(() => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a'), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'TENANT_DATA_INCOMPLETE');
      return true;
    });
    assert.equal(log.customers.length, 0);
    assert.equal(tenantUpdates.length, 0);
  });

  it('exactly one client: it is referenced and nothing is created', async () => {
    customers = [{ _id: C1, Razonsocial: 'Hospital X' }];
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a');
    assert.equal(log.customers.length, 0);
    assert.equal(out.organizationCustomerCreated, false);
    assert.equal(String(out.organizationCustomerId), C1);
  });

  it('several clients without a choice: 409 ORGANIZATION_CUSTOMER_REQUIRED with the candidates, nothing changes', async () => {
    customers = [{ _id: C1, Razonsocial: 'A' }, { _id: C2, Razonsocial: 'B' }, { _id: C3, Razonsocial: 'C' }];
    await assert.rejects(() => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a'), (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'ORGANIZATION_CUSTOMER_REQUIRED');
      assert.equal(err.details.candidates.length, 3);
      assert.deepEqual(err.details.candidates.map((c) => String(c._id)), [C1, C2, C3]);
      return true;
    });
    assert.equal(tenantUpdates.length, 0);
    assert.equal(log.customers.length, 0);
  });

  it('several clients with a valid choice: it becomes the organization client, the others are untouched', async () => {
    customers = [{ _id: C1 }, { _id: C2 }, { _id: C3 }];
    orgLookup[C2] = { _id: C2, kind: 'customer', tenantId: 'acme' };
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client', organizationCustomerId: C2 }, 'a');
    assert.equal(String(out.organizationCustomerId), C2);
    assert.equal(String(tenantUpdates[0].update.$set.organizationCustomerId), C2);
    assert.equal(log.customers.length, 0);
    assert.equal(log.softDeletes.length, 0);
    assert.equal(log.hardDeletes, 0);
  });

  it('a chosen id that is not a client of the tenant is 400 INVALID_ORGANIZATION_CUSTOMER', async () => {
    customers = [{ _id: C1 }, { _id: C2 }];
    await assert.rejects(
      () => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client', organizationCustomerId: C3 }, 'a'),
      (err) => err.statusCode === 400 && err.code === 'INVALID_ORGANIZATION_CUSTOMER',
    );
    assert.equal(tenantUpdates.length, 0);
  });

  it('a chosen organization client is rejected when the tenant keeps executing services', async () => {
    orgLookup[C2] = { _id: C2, kind: 'customer', tenantId: 'acme' };
    await assert.rejects(
      () => PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'hybrid', organizationCustomerId: C2 }, 'a'),
      (err) => err.statusCode === 400,
    );
  });

  it('a tenant that already has a valid organization client keeps it when switched again (no 409)', async () => {
    tenant = completeTenant({
      capabilities: { executesServices: true, registersExternal: true },
      organizationCustomerId: C1,
    });
    customers = [{ _id: C1 }, { _id: C2 }];
    orgLookup[C1] = { _id: C1, kind: 'customer', tenantId: 'acme' };
    const out = await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a');
    assert.equal(String(out.organizationCustomerId), C1);
    assert.equal(log.customers.length, 0);
  });

  it('never deletes or reassigns anything', async () => {
    customers = [{ _id: C1 }];
    await PlatformTenantService.updateCapabilities(TENANT_ID_MONGO, { type: 'client' }, 'a');
    assert.equal(log.softDeletes.length, 0);
    assert.equal(log.hardDeletes, 0);
  });
});
