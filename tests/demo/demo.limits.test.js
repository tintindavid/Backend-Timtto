/** Cuentas demo — Tarea 2: límites de usuarios, clientes y equipos. DB-free. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DEMO_LIMITS } from '../../src/constants/demo.constants.js';
import { withDemoQuota, getDemoUsage } from '../../src/services/demo/demoLimits.service.js';
import { userService } from '../../src/services/user.service.js';
import { customerService } from '../../src/services/customer.service.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { OTService } from '../../src/services/ot.service.js';
import { DemoLock } from '../../src/models/demoLock.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { emailService } from '../../src/services/external/email.service.js';

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

let world;
beforeEach(() => {
  world = { counts: { users: 1, customers: 1, equipos: 15 }, locks: new Map(), lockCalls: 0, filters: [] };
  stub(Tenant, 'findOne', (filter) => ({
    lean: async () => (filter.tenantId === 'demo1'
      ? { tenantId: 'demo1', demo: { enabled: true, limits: { ...DEMO_LIMITS } } }
      : { tenantId: filter.tenantId }),
  }));
  stub(DemoLock, 'create', async (doc) => {
    world.lockCalls += 1;
    const key = `${doc.tenantId}:${doc.resource}`;
    if (world.locks.has(key)) throw Object.assign(new Error('dup'), { code: 11000 });
    world.locks.set(key, doc.owner);
    return doc;
  });
  stub(DemoLock, 'deleteOne', async (f) => {
    const key = `${f.tenantId}:${f.resource}`;
    if (f.owner && world.locks.get(key) === f.owner) world.locks.delete(key);
    return {};
  });
  for (const [Model, name] of [[User, 'users'], [Customer, 'customers'], [EquipoItem, 'equipos']]) {
    stub(Model, 'countDocuments', async (f) => { world.filters.push([name, f]); return world.counts[name]; });
  }
});

const limitError = (resource, limit, used) => (e) => e.statusCode === 403 && e.code === 'DEMO_LIMIT_REACHED'
  && e.details.resource === resource && e.details.limit === limit && e.details.used === used;

describe('withDemoQuota', () => {
  it('does not touch DemoLock for a normal tenant', async () => {
    assert.equal(await withDemoQuota('normal', 'equipos', 999, async () => 'ok'), 'ok');
    assert.equal(world.lockCalls, 0);
  });

  it('releases the lock when work throws', async () => {
    await assert.rejects(() => withDemoQuota('demo1', 'equipos', 1, async () => { throw new Error('boom'); }), /boom/);
    assert.equal(world.locks.size, 0);
  });

  it('counts are tenant scoped and exclude providers and deleted records', async () => {
    assert.deepEqual(await getDemoUsage('demo1'), world.counts);
    const byName = Object.fromEntries(world.filters);
    for (const f of Object.values(byName)) { assert.equal(f.tenantId, 'demo1'); assert.equal(f.isDeleted, false); }
    assert.deepEqual(byName.customers.kind, { $ne: 'provider' });
  });

  it('allows exactly the remaining slots under concurrency', async () => {
    world.counts.equipos = 48;
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
      withDemoQuota('demo1', 'equipos', 1, async () => { await new Promise((r) => setImmediate(r)); world.counts.equipos += 1; })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal(world.counts.equipos, 50);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'DEMO_LIMIT_REACHED'));
  });
});

describe('service limits', () => {
  it('rejects the third user before inserting or emailing', async () => {
    world.counts.users = 2;
    stub(User, 'findOne', async () => null);
    stub(User, 'create', async () => { throw new Error('must not insert'); });
    stub(emailService, 'sendWelcomeEmail', async () => { throw new Error('must not email'); });
    await assert.rejects(() => userService.create({ tenantId: 'demo1', email: 'x@example.com' }), limitError('users', 2, 2));
  });

  it('rejects the fourth customer before uploading the logo', async () => {
    world.counts.customers = 3;
    stub(firebaseStorageService, 'uploadLogo', async () => { throw new Error('must not upload'); });
    stub(Customer, 'create', async () => { throw new Error('must not insert'); });
    const data = { Razonsocial: 'C', Nit: 1, Ciudad: 'x', Departamento: 'y', Email: 'c@example.com', TelContacto: '1', UserContacto: 'u' };
    await assert.rejects(() => customerService.create(data, 'demo1', { buffer: Buffer.from('a') }), limitError('customers', 3, 3));
  });

  it('does not limit providers', async () => {
    world.counts.customers = 3;
    stub(Customer, 'create', async (d) => ({ ...d, _id: 'p1' }));
    const created = await customerService.create({ kind: 'provider', Razonsocial: 'P' }, 'demo1');
    assert.equal(created._id, 'p1');
  });

  it('allows equipment 50 and rejects 51', async () => {
    stub(equipoItemService, '_guardDuplicate', async () => {});
    stub(Customer, 'findOne', () => ({ select: () => ({ lean: async () => ({ kind: 'customer' }) }), lean: async () => ({ kind: 'customer' }) }));
    stub(EquipoItem, 'create', async (d) => { world.counts.equipos += 1; return { ...d, _id: 'e1' }; });
    world.counts.equipos = 49;
    await equipoItemService.create({ Serie: 'A1' }, 'demo1');
    await assert.rejects(() => equipoItemService.create({ Serie: 'A2' }, 'demo1'), limitError('equipos', 50, 50));
  });

  it('rejects an OT batch that does not fit, creating nothing', async () => {
    world.counts.equipos = 49;
    stub(OT, 'findOne', async () => ({ _id: 'ot1', reportes: [] }));
    for (const [Model, key] of [[EquipoItem, 'create'], [Report, 'create'], [Counter, 'findOneAndUpdate']]) {
      stub(Model, key, () => { throw new Error('must not write'); });
    }
    await assert.rejects(
      () => new OTService().addEquipos('ot1', { equipos: [{ equipo: { Serie: 'A' } }, { equipo: { Serie: 'B' } }] }, 'demo1'),
      limitError('equipos', 50, 49),
    );
  });
});
