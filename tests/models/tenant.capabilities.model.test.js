/**
 * tests/models/tenant.capabilities.model.test.js
 * tenant-capabilities-hybrid-mode, task 3.1: schema defaults and the "at least one flag" validator.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';

const base = { tenantId: 'acme', name: 'Acme' };

describe('Tenant.capabilities', () => {
  it('defaults to provider (executesServices true, registersExternal false) and no organization client', () => {
    const t = new Tenant(base);
    assert.equal(t.capabilities.executesServices, true);
    assert.equal(t.capabilities.registersExternal, false);
    assert.equal(t.organizationCustomerId, null);
    assert.equal(t.validateSync(), undefined);
  });

  it('usesQrs defaults to false and does not count for the "at least one capability" rule', () => {
    assert.equal(new Tenant(base).capabilities.usesQrs, false);
    assert.equal(new Tenant({ ...base, capabilities: { usesQrs: true } }).validateSync(), undefined);
    const none = new Tenant({ ...base, capabilities: { executesServices: false, registersExternal: false, usesQrs: true } }).validateSync();
    assert.ok(none, 'usesQrs alone is not a valid tenant');
  });

  it('scheduleQuickLoad defaults to false', () => {
    assert.equal(new Tenant(base).capabilities.scheduleQuickLoad, false);
    assert.equal(new Tenant({ ...base, capabilities: { registersExternal: true, scheduleQuickLoad: true } }).validateSync(), undefined);
  });

  it('accepts client, hybrid and provider combinations', () => {
    for (const caps of [
      { executesServices: false, registersExternal: true },
      { executesServices: true, registersExternal: true },
      { executesServices: true, registersExternal: false },
    ]) {
      assert.equal(new Tenant({ ...base, capabilities: caps }).validateSync(), undefined);
    }
  });

  it('rejects both flags false', () => {
    const err = new Tenant({ ...base, capabilities: { executesServices: false, registersExternal: false } }).validateSync();
    assert.ok(err, 'validation error expected');
    assert.ok(Object.keys(err.errors).some((k) => k.startsWith('capabilities')));
  });

  it('rejects a partial object that resolves to both false', () => {
    const err = new Tenant({ ...base, capabilities: { executesServices: false } }).validateSync();
    assert.ok(err);
  });

  it('does not store the derived type', () => {
    const t = new Tenant({ ...base, type: 'client' });
    assert.equal(t.toObject().type, undefined);
  });

  it('accepts an ObjectId as organizationCustomerId', () => {
    const t = new Tenant({ ...base, organizationCustomerId: '507f1f77bcf86cd799439011' });
    assert.equal(t.validateSync(), undefined);
    assert.equal(String(t.organizationCustomerId), '507f1f77bcf86cd799439011');
  });
});
