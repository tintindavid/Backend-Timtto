/** Cuentas demo — Tarea 9: GET /my-tenant/demo. DB-free. */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import myTenantRoutes from '../../src/routes/myTenant.routes.js';
import { MyTenantController } from '../../src/controllers/myTenant.controller.js';
import { demoLookup } from '../../src/services/demo/demoContext.service.js';
import { DEMO_LIMITS } from '../../src/constants/demo.constants.js';
import { User } from '../../src/models/user.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';

const originals = [
  [demoLookup, 'find', demoLookup.find],
  [User, 'countDocuments', User.countDocuments],
  [Customer, 'countDocuments', Customer.countDocuments],
  [EquipoItem, 'countDocuments', EquipoItem.countDocuments],
];
afterEach(() => { for (const [t, k, v] of originals) t[k] = v; });

async function call(tenantId) {
  let body;
  const res = { status() { return this; }, json(payload) { body = payload; return this; } };
  await MyTenantController.getDemoStatus({ tenantId, user: { tenantId: 'token-tenant' } }, res, (e) => { throw e; });
  return body.data;
}

describe('GET /my-tenant/demo', () => {
  it('answers enabled=false for a regular tenant without counting anything', async () => {
    demoLookup.find = async () => null;
    User.countDocuments = async () => { throw new Error('must not count'); };
    assert.deepEqual(await call('acme'), { enabled: false });
  });

  it('returns limits and usage of the effective tenant', async () => {
    const seen = [];
    demoLookup.find = async (t) => { seen.push(t); return { demo: { enabled: true, limits: { ...DEMO_LIMITS }, seedStatus: 'ready' } }; };
    const count = (n) => async (filter) => { seen.push(filter.tenantId); return n; };
    User.countDocuments = count(1);
    Customer.countDocuments = count(2);
    EquipoItem.countDocuments = count(15);
    const data = await call('demo1');
    assert.deepEqual(data, { enabled: true, limits: { ...DEMO_LIMITS }, usage: { users: 1, customers: 2, equipos: 15 } });
    assert.deepEqual([...new Set(seen)], ['demo1']);
  });

  it('only requires authentication', () => {
    const layer = myTenantRoutes.stack.find((l) => l.route?.path === '/demo' && l.route.methods.get);
    assert.deepEqual(layer.route.stack.map((s) => s.handle.name), ['authenticate', 'getDemoStatus']);
  });
});
