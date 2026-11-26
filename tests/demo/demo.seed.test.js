/** Cuentas demo — Tarea 8: siembra y reintento. DB-free (in-memory stubs of the persistence layer). */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { seedDemoTenant, seedDeps } from '../../src/services/demo/demoSeed.service.js';
import { demoLookup } from '../../src/services/demo/demoContext.service.js';
import { demoId } from '../../src/services/demo/demoIds.js';
import { DEMO_LIMITS } from '../../src/constants/demo.constants.js';
import { demoCapabilities } from '../../src/config/tenantCapabilities.config.js';
import { DemoLock } from '../../src/models/demoLock.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { PlatformTenantService } from '../../src/services/platformTenant.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { emailService } from '../../src/services/external/email.service.js';
import { catalogoFixture } from './catalogoFixture.js';

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, Object.getOwnPropertyDescriptor(target, key)]); target[key] = value; }
afterEach(() => {
  while (stubs.length) {
    const [target, key, descriptor] = stubs.pop();
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  }
});

let store;
let counters;
let seedStatus;
let failOn;
let drafts;
let usage;
let tenant;

const bucket = (name) => {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
};
const total = () => [...store.values()].reduce((sum, m) => sum + m.size, 0);

beforeEach(() => {
  store = new Map();
  counters = new Map();
  seedStatus = [];
  failOn = null;
  drafts = [];
  usage = { users: 1, customers: 0, equipos: 0 };
  stub(demoLookup, 'find', async (t) => (t === 'demo1' ? { demo: { enabled: true, limits: { ...DEMO_LIMITS } } } : null));
  stub(seedDeps, 'getUsage', async () => usage);
  tenant = null;
  stub(seedDeps, 'getTenant', async () => tenant);
  stub(DemoLock, 'create', async () => ({}));
  stub(DemoLock, 'deleteOne', async () => ({}));
  stub(User, 'findOne', () => ({ sort: () => ({ lean: async () => ({ _id: demoId('x', 'admin'), firstName: 'Ana', lastName: 'Ruiz' }) }) }));
  stub(Tenant, 'updateOne', async (_f, u) => { seedStatus.push(u.$set['demo.seedStatus']); return {}; });
  stub(Counter, 'updateOne', async (f, u) => { counters.set(f.key, Math.max(counters.get(f.key) ?? 0, u.$max.seq)); return {}; });
  stub(seedDeps, 'loadCatalog', () => catalogoFixture());
  stub(seedDeps, 'findExistingIds', async (Model, _tenantId, ids) => ids.map(String).filter((i) => bucket(Model.modelName).has(i)));
  stub(seedDeps, 'insert', async (Model, doc) => {
    if (failOn === Model.modelName) throw new Error('db down');
    bucket(Model.modelName).set(String(doc._id), { ...doc });
  });
  stub(seedDeps, 'seedRequisiciones', async (tenantId) => { drafts.push(tenantId); return { created: 0, notes: [] }; });
});

describe('seedDemoTenant', () => {
  it('inserts everything once, marks it ready and creates nothing the second time', async () => {
    const first = await seedDemoTenant('demo1');
    assert.equal(first.status, 'ready', first.error);
    assert.equal(first.created, total());
    assert.ok(first.created > 40);
    const second = await seedDemoTenant('demo1');
    assert.equal(second.status, 'ready');
    assert.equal(second.created, 0);
    assert.deepEqual(seedStatus, ['ready', 'ready']);
    assert.deepEqual(drafts, ['demo1', 'demo1']);
  });

  it('never overwrites edited records nor revives deleted ones', async () => {
    await seedDemoTenant('demo1');
    const [editedId, deletedId] = [...bucket('EquipoItem').keys()];
    bucket('EquipoItem').get(editedId).Marca = 'Editada';
    bucket('EquipoItem').get(deletedId).isDeleted = true;
    await seedDemoTenant('demo1');
    assert.equal(bucket('EquipoItem').get(editedId).Marca, 'Editada');
    assert.equal(bucket('EquipoItem').get(deletedId).isDeleted, true);
  });

  it('reports an error without throwing and completes the rest on retry', async () => {
    failOn = 'OT';
    const failed = await seedDemoTenant('demo1');
    assert.equal(failed.status, 'error');
    assert.match(failed.error, /db down/);
    assert.equal(bucket('OT').size, 0);
    assert.ok(counters.get('OT') >= 9, 'counters are reserved before inserting');
    failOn = null;
    const retried = await seedDemoTenant('demo1');
    assert.equal(retried.status, 'ready');
    assert.equal(bucket('OT').size, 9);
    assert.deepEqual(seedStatus, ['error', 'ready']);
  });

  it('seeds according to the capabilities of the tenant', async () => {
    tenant = { name: 'Hospital Demo', capabilities: demoCapabilities('client') };
    assert.equal((await seedDemoTenant('demo1')).status, 'ready');
    assert.equal(bucket('OT').size, 0);
    assert.ok(bucket('Report').size >= 15);
  });

  it('writes nothing when completing the sample data would exceed a limit', async () => {
    for (const over of [{ users: 1, customers: 3, equipos: 0 }, { users: 1, customers: 0, equipos: 40 }]) {
      usage = over;
      const result = await seedDemoTenant('demo1');
      assert.equal(result.status, 'error');
      assert.match(result.error, /límite/);
      assert.equal(total(), 0);
    }
  });

  it('completes a retry at the limit when nothing limited is missing', async () => {
    await seedDemoTenant('demo1');
    usage = { users: 2, customers: 3, equipos: 50 };
    assert.equal((await seedDemoTenant('demo1')).status, 'ready');
  });

  it('never moves a counter backwards', async () => {
    counters.set('OT', 900);
    await seedDemoTenant('demo1');
    assert.equal(counters.get('OT'), 900);
  });

  it('does nothing on a regular tenant', async () => {
    const result = await seedDemoTenant('acme');
    assert.equal(result.status, 'error');
    assert.equal(total(), 0);
    assert.equal(counters.size, 0);
    assert.deepEqual(seedStatus, []);
  });
});

describe('createWithAdmin and the sample data', () => {
  const payload = (isDemo) => ({
    tenant: { tenantId: 'demo1', name: 'Demo', ...(isDemo ? { isDemo: true } : {}) },
    admin: { email: 'a@example.com', firstName: 'A', lastName: 'B' },
  });

  it('validates the catalogue before writing anything', async () => {
    stub(seedDeps, 'loadCatalog', () => { throw Object.assign(new Error('missing'), { code: 'DEMO_CATALOG_MISSING' }); });
    stub(Tenant, 'findOne', () => { throw new Error('must not query'); });
    stub(Tenant, 'create', async () => { throw new Error('must not create'); });
    stub(firebaseStorageService, 'uploadLogo', async () => { throw new Error('must not upload'); });
    stub(mongoose, 'startSession', async () => { throw new Error('must not start'); });
    await assert.rejects(
      () => PlatformTenantService.createWithAdmin(payload(true), { buffer: Buffer.from('x') }),
      (e) => e.code === 'DEMO_CATALOG_MISSING',
    );
  });

  const stubCreation = () => {
    stub(PlatformTenantService, '_seedRequisiciones', async () => ({}));
    stub(emailService, 'sendWelcomeEmail', async () => ({}));
    const doc = (data) => ({ ...data, toJSON: () => ({ ...data }) });
    stub(Tenant, 'findOne', () => ({ setOptions: () => ({ lean: async () => null }) }));
    stub(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
    stub(Tenant, 'create', async ([data]) => [doc(data)]);
    stub(User, 'create', async ([data]) => [doc(data)]);
    return import('../../src/models/role.model.js').then(({ Role }) => stub(Role, 'create', async ([data]) => [doc({ _id: 'r', ...data })]));
  };

  it('seeds a demo account after creating it and reports the result', async () => {
    await stubCreation();
    const result = await PlatformTenantService.createWithAdmin(payload(true));
    assert.equal(result.demoSeed.status, 'ready', result.demoSeed.error);
    assert.equal(result.tenant.demo.seedStatus, 'ready');
    assert.ok(total() > 40);
  });

  it('does not seed a regular tenant', async () => {
    await stubCreation();
    stub(seedDeps, 'loadCatalog', () => { throw new Error('must not load'); });
    const result = await PlatformTenantService.createWithAdmin({ ...payload(false), capabilities: { executesServices: true, managesCustomers: true } });
    assert.equal('demoSeed' in result, false);
    assert.equal(total(), 0);
  });
});

describe('retry endpoint', () => {
  it('rejects a tenant that is not a demo account', async () => {
    stub(Tenant, 'findById', () => ({ lean: async () => ({ tenantId: 'acme' }) }));
    await assert.rejects(
      () => PlatformTenantService.retryDemoSeed('507f1f77bcf86cd799439011'),
      (e) => e.statusCode === 400 && e.code === 'NOT_A_DEMO_TENANT',
    );
  });

  it('is exposed only to the super admin', async () => {
    const { default: router } = await import('../../src/routes/platformTenant.routes.js');
    const layer = router.stack.find((l) => l.route?.path === '/:id/demo/seed' && l.route.methods.post);
    assert.ok(layer);
    const names = layer.route.stack.map((s) => s.handle.name);
    assert.deepEqual(names.slice(0, 2), ['authenticate', 'requireSuperAdmin']);
  });
});
