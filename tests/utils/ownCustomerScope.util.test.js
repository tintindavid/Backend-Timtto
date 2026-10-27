/**
 * "Mantenimiento propio" scope (managesCustomers=false): pure unit tests.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getOwnCustomerScope, applyOwnCustomerOnCreate, assertOwnCustomerOnUpdate } from '../../src/utils/ownCustomerScope.util.js';

const ORG = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const OWN = { capabilities: { executesServices: true, registersExternal: false, managesCustomers: false }, organizationCustomerId: ORG };
const MANAGING = { capabilities: { executesServices: true, registersExternal: false, managesCustomers: true }, organizationCustomerId: null };
const LEGACY = { capabilities: { executesServices: true, registersExternal: false }, organizationCustomerId: null };

describe('ownCustomerScope', () => {
  let saved;
  beforeEach(() => { saved = process.env.ENFORCE_TENANT_CAPABILITIES; delete process.env.ENFORCE_TENANT_CAPABILITIES; });
  afterEach(() => { if (saved === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = saved; });

  it('is not scoped without tenant context, for managing tenants, legacy tenants and tenants that do not execute services', () => {
    assert.equal(getOwnCustomerScope(undefined), null);
    assert.equal(getOwnCustomerScope(MANAGING), null);
    assert.equal(getOwnCustomerScope(LEGACY), null);
    assert.equal(getOwnCustomerScope({ capabilities: { executesServices: false, registersExternal: true }, organizationCustomerId: ORG }), null);
  });

  it('is scoped when executesServices and not managesCustomers', () => {
    assert.deepEqual(getOwnCustomerScope(OWN), { organizationCustomerId: ORG });
  });

  it('scoped tenant without an organization customer is 409 ORGANIZATION_CUSTOMER_MISSING', () => {
    assert.throws(() => getOwnCustomerScope({ ...OWN, organizationCustomerId: null }), (e) => e.statusCode === 409 && e.code === 'ORGANIZATION_CUSTOMER_MISSING');
  });

  it('honours the rollout mode (off / warn do not scope)', () => {
    for (const mode of ['off', 'warn']) {
      process.env.ENFORCE_TENANT_CAPABILITIES = mode;
      assert.equal(getOwnCustomerScope(OWN), null, mode);
    }
  });

  it('create: fills a missing ClienteId, accepts the organization customer, rejects any other with 403 CLIENTE_NO_PERMITIDO', () => {
    assert.equal(applyOwnCustomerOnCreate(OWN, {}).ClienteId, ORG);
    assert.equal(applyOwnCustomerOnCreate(OWN, { ClienteId: '' }).ClienteId, ORG);
    assert.equal(applyOwnCustomerOnCreate(OWN, { ClienteId: ORG }).ClienteId, ORG);
    assert.throws(() => applyOwnCustomerOnCreate(OWN, { ClienteId: OTHER }), (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO');
    assert.equal(applyOwnCustomerOnCreate(OWN, {}, 'clienteId').clienteId, ORG);
  });

  it('create: managing tenants are untouched', () => {
    const data = {};
    applyOwnCustomerOnCreate(MANAGING, data);
    assert.equal('ClienteId' in data, false);
    assert.equal(applyOwnCustomerOnCreate(MANAGING, { ClienteId: OTHER }).ClienteId, OTHER);
  });

  it('update: accepts the organization customer and the unchanged stored client, rejects a different one, never fills', () => {
    assertOwnCustomerOnUpdate(OWN, ORG, OTHER);
    assertOwnCustomerOnUpdate(OWN, OTHER, OTHER);
    assertOwnCustomerOnUpdate(OWN, undefined, OTHER);
    assert.throws(() => assertOwnCustomerOnUpdate(OWN, OTHER, ORG), (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO');
    assertOwnCustomerOnUpdate(MANAGING, OTHER, ORG);
  });
});
