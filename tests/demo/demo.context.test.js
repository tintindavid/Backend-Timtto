/** Cuentas demo — Tarea 1: marca demo en el tenant. DB-free. */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { DEMO_LIMITS } from '../../src/constants/demo.constants.js';
import { getDemoConfig, assertNotDemo, blockInDemo } from '../../src/services/demo/demoContext.service.js';
import { createTenantWithAdminSchema } from '../../src/dtos/createTenantWithAdmin.dto.js';
import { updateTenantMetadataSchema } from '../../src/dtos/updateTenantMetadata.dto.js';
import { updateTenantSchema } from '../../src/dtos/updateTenant.dto.js';
import { ALL_CAPABILITIES_ENABLED } from '../../src/config/tenantCapabilities.config.js';
import { PlatformTenantService } from '../../src/services/platformTenant.service.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { emailService } from '../../src/services/external/email.service.js';
import { seedDeps } from '../../src/services/demo/demoSeed.service.js';
import { demoId } from '../../src/services/demo/demoIds.js';

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
afterEach(() => { while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; } });

const demoTenant = { tenantId: 'demo1', demo: { enabled: true, limits: { ...DEMO_LIMITS }, seedStatus: 'ready' } };
function tenantWorld(docs) {
  const calls = [];
  stub(Tenant, 'findOne', (filter, projection) => {
    calls.push({ filter, projection });
    return { lean: async () => docs.find((d) => d.tenantId === filter.tenantId) ?? null };
  });
  return calls;
}
const admin = { email: 'a@example.com', firstName: 'Ana', lastName: 'Ruiz' };

describe('demo context', () => {
  it('getDemoConfig is null without demo or when disabled, and queries by tenantId', async () => {
    const calls = tenantWorld([{ tenantId: 'normal' }, { tenantId: 'off', demo: { enabled: false } }, demoTenant]);
    assert.equal(await getDemoConfig('normal'), null);
    assert.equal(await getDemoConfig('off'), null);
    assert.equal((await getDemoConfig('demo1')).limits.equipos, 50);
    assert.deepEqual(calls[0].filter, { tenantId: 'normal' });
  });

  it('assertNotDemo blocks only demo tenants', async () => {
    tenantWorld([{ tenantId: 'normal' }, demoTenant]);
    await assertNotDemo('normal', 'reports-zip');
    await assert.rejects(() => assertNotDemo('demo1', 'reports-zip'),
      (e) => e.statusCode === 403 && e.code === 'DEMO_FEATURE_BLOCKED' && e.details.feature === 'reports-zip');
  });

  it('blockInDemo forwards the error to next', async () => {
    tenantWorld([{ tenantId: 'normal' }, demoTenant]);
    const run = (tenantId) => new Promise((resolve) => blockInDemo('excel-clientes')({ tenantId }, {}, resolve));
    assert.equal(await run('normal'), undefined);
    assert.equal((await run('demo1')).code, 'DEMO_FEATURE_BLOCKED');
  });
});

describe('demo DTOs', () => {
  it('accepts tenant.isDemo without organization data even with a client type', () => {
    const body = { tenant: { tenantId: 'demo1', name: 'Demo', isDemo: true }, admin, type: 'client' };
    assert.equal(createTenantWithAdminSchema.validate(body).error, undefined);
  });
  it('rejects a client-supplied demo key', () => {
    const body = { tenant: { tenantId: 'demo1', name: 'Demo', demo: { enabled: true } }, admin };
    assert.ok(createTenantWithAdminSchema.validate(body).error);
  });
  it('edit schemas never let demo through', () => {
    assert.ok(updateTenantMetadataSchema.validate({ demo: { enabled: false } }).error);
    assert.ok(updateTenantMetadataSchema.validate({ isDemo: false }).error);
    const legacy = updateTenantSchema.validate({ name: 'x', demo: { enabled: false }, isDemo: false });
    assert.deepEqual(legacy.value, { name: 'x' });
  });
});

describe('createWithAdmin demo by type', () => {
  const expected = {
    provider: { executesServices: true, registersExternal: false, managesCustomers: true, scheduleQuickLoad: false },
    client: { executesServices: false, registersExternal: true, managesCustomers: false, scheduleQuickLoad: true },
    hybrid: { executesServices: true, registersExternal: true, managesCustomers: true, scheduleQuickLoad: true },
  };
  for (const [type, flags] of Object.entries(expected)) {
    it(`${type}: capabilities of the type, premium modules on`, async () => {
      let persisted;
      stub(Tenant, 'findOne', () => ({ setOptions: () => ({ lean: async () => null }) }));
      stub(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
      stub(Tenant, 'create', async ([doc]) => { persisted = doc; return [{ ...doc, toJSON: () => doc }]; });
      stub(Role, 'create', async ([doc]) => [{ ...doc, _id: new mongoose.Types.ObjectId() }]);
      stub(User, 'create', async ([doc]) => [{ ...doc, toJSON: () => doc }]);
      stub(emailService, 'sendWelcomeEmail', async () => {});
      stub(PlatformTenantService, '_seedRequisiciones', async () => ({}));
      stub(PlatformTenantService, '_withDemoSeed', async (r) => r);
      stub(PlatformTenantService, '_createOrganizationClient', async () => { throw new Error('the seed creates it'); });
      stub(seedDeps, 'loadCatalog', () => ({}));

      const body = { tenant: { tenantId: 'demo1', name: 'Demo', isDemo: true }, admin, type };
      assert.equal(createTenantWithAdminSchema.validate(body).error, undefined);
      await PlatformTenantService.createWithAdmin(body);

      assert.deepEqual(persisted.capabilities, { ...ALL_CAPABILITIES_ENABLED, ...flags });
      assert.equal(
        persisted.organizationCustomerId && String(persisted.organizationCustomerId),
        type === 'client' ? String(demoId('demo1', 'customer:cliente')) : undefined,
      );
    });
  }
});

describe('createWithAdmin demo', () => {
  it('persists demo limits and all capabilities, without isDemo', async () => {
    let persisted;
    stub(Tenant, 'findOne', () => ({ setOptions: () => ({ lean: async () => null }) }));
    stub(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
    stub(Tenant, 'create', async ([doc]) => { persisted = doc; return [{ ...doc, toJSON: () => doc }]; });
    stub(Role, 'create', async ([doc]) => [{ ...doc, _id: new mongoose.Types.ObjectId() }]);
    stub(User, 'create', async ([doc]) => [{ ...doc, toJSON: () => doc }]);
    stub(emailService, 'sendWelcomeEmail', async () => {});
    stub(PlatformTenantService, '_seedRequisiciones', async () => ({}));
    stub(seedDeps, 'loadCatalog', () => ({})); // the catalogue file is not needed here

    await PlatformTenantService.createWithAdmin({ tenant: { tenantId: 'demo1', name: 'Demo', isDemo: true }, admin });

    assert.deepEqual(persisted.demo, { enabled: true, limits: { ...DEMO_LIMITS }, seedStatus: 'pending' });
    assert.deepEqual(persisted.capabilities, { ...ALL_CAPABILITIES_ENABLED });
    assert.equal('isDemo' in persisted, false);
    assert.equal(persisted.organizationCustomerId, undefined);
  });

  it('the schema stores demo only when present', () => {
    assert.equal(new Tenant({ tenantId: 'a', name: 'A' }).demo?.enabled, undefined);
    const t = new Tenant({ tenantId: 'b', name: 'B', demo: { enabled: true, limits: DEMO_LIMITS, seedStatus: 'pending' } });
    assert.equal(t.demo.limits.pdfPerDocument, 2);
  });
});
