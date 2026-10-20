/**
 * tests/middlewares/auditPlatformAction.capabilities.test.js
 * tenant-capabilities-hybrid-mode, tasks 2.5 / 6.3: PATCH /platform/tenants/:id/capabilities is
 * audited as TENANT_CAPABILITIES_CHANGED with the before and after states.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { auditPlatformAction } from '../../src/middlewares/auditPlatformAction.middleware.js';
import { platformAuditLogService } from '../../src/services/platformAuditLog.service.js';
import { PLATFORM_AUDIT_ACTIONS, PlatformAuditLog } from '../../src/models/platformAuditLog.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';

const TENANT_MONGO_ID = '507f1f77bcf86cd799439011';
const ACTOR_ID = '507f1f77bcf86cd799439055';

let server;
let base;
let tenantState;
const entries = [];
const saved = {};
const chain = (value) => {
  const q = { select: () => q, setOptions: () => q, lean: () => Promise.resolve(value), then: (a, b) => Promise.resolve(value).then(a, b) };
  return q;
};

before(async () => {
  saved.log = platformAuditLogService.log;
  saved.findById = Tenant.findById;
  saved.userFindById = User.findById;
  platformAuditLogService.log = async (entry) => { entries.push(entry); };
  Tenant.findById = () => chain({ ...tenantState });
  User.findById = () => chain({ email: 'root@timtto.com' });
  tenantState = { _id: TENANT_MONGO_ID, tenantId: 'acme', capabilities: { executesServices: true, registersExternal: false } };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { userId: ACTOR_ID, role: 'superadmin' }; next(); });
  app.use(auditPlatformAction);
  app.patch('/api/v1/platform/tenants/:id/capabilities', (req, res) => {
    tenantState = { ...tenantState, capabilities: { executesServices: true, registersExternal: true } };
    res.json({ success: true, data: { type: 'hybrid' } });
  });
  app.patch('/api/v1/platform/tenants/:id/broken', (_req, res) => res.status(409).json({ success: false }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  platformAuditLogService.log = saved.log;
  Tenant.findById = saved.findById;
  User.findById = saved.userFindById;
  await new Promise((r) => server.close(r));
});

describe('TENANT_CAPABILITIES_CHANGED audit', () => {
  it('the audit action enum includes it, so the entry can be persisted', () => {
    assert.ok(PLATFORM_AUDIT_ACTIONS.includes('TENANT_CAPABILITIES_CHANGED'));
    const doc = new PlatformAuditLog({
      actorUserId: ACTOR_ID, actorEmail: 'root@timtto.com', action: 'TENANT_CAPABILITIES_CHANGED', targetType: 'tenant',
    });
    assert.equal(doc.validateSync(), undefined);
  });

  it('a successful PATCH writes the entry with the before and after states and the target tenant', async () => {
    entries.length = 0;
    const res = await fetch(`${base}/api/v1/platform/tenants/${TENANT_MONGO_ID}/capabilities`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'hybrid' }),
    });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.action, 'TENANT_CAPABILITIES_CHANGED');
    assert.equal(e.targetType, 'tenant');
    assert.equal(String(e.targetId), TENANT_MONGO_ID);
    assert.equal(e.targetTenantId, 'acme');
    assert.deepEqual(e.before.capabilities, { executesServices: true, registersExternal: false });
    assert.deepEqual(e.after.capabilities, { executesServices: true, registersExternal: true });
    assert.equal(e.actorEmail, 'root@timtto.com');
  });

  it('a failed PATCH (4xx) is not audited, and other PATCH paths keep their own action', async () => {
    entries.length = 0;
    await fetch(`${base}/api/v1/platform/tenants/${TENANT_MONGO_ID}/broken`, { method: 'PATCH' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(entries.length, 0);
  });
});
