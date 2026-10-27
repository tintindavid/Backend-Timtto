/**
 * "Gestiona clientes" (managesCustomers): customer writes by kind. DB-free (model statics stubbed).
 * A tenant that executes services but does not manage customers ("mantenimiento propio") cannot
 * create / edit / delete kind=customer documents (403 CAPABILITY_DISABLED), except that the
 * system-managed organization customer stays editable. Providers are never gated here. Reads are untouched.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { customerService } from '../../src/services/customer.service.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Servicios } from '../../src/models/servicios.model.js';

const TENANT = 'clinic';
const ID = '507f1f77bcf86cd799439001';
const ORG = '507f1f77bcf86cd799439002';
const OWN = { executesServices: true, registersExternal: false, managesCustomers: false };
const MANAGING = { executesServices: true, registersExternal: false, managesCustomers: true };
const LEGACY = { executesServices: true, registersExternal: false };

const payload = (extra = {}) => ({
  Razonsocial: 'Acme', Ciudad: 'Bogota', Departamento: 'Cundinamarca', Email: 'a@acme.com', Nit: 900,
  TelContacto: '3001234567', UserContacto: 'Ana Perez', ...extra,
});

const denied = (err) => {
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'CAPABILITY_DISABLED');
  assert.match(err.message, /gestiona clientes/i);
  return true;
};

describe('customerService writes with managesCustomers=false', () => {
  afterEach(() => {
    delete Customer.create; delete Sedes.create; delete Servicios.create;
    delete Customer.findOne; delete Customer.findOneAndUpdate;
  });

  it('create kind=customer is 403 and stores nothing; providers are allowed', async () => {
    const calls = [];
    Customer.create = async (d) => { calls.push(d); return { _id: ID, ...d }; };
    Sedes.create = async (d) => ({ _id: 's1', ...d });
    Servicios.create = async (d) => ({ _id: 'sv1', ...d });
    await assert.rejects(() => customerService.create(payload(), TENANT, null, OWN), denied);
    assert.equal(calls.length, 0);
    await customerService.create(payload({ kind: 'provider' }), TENANT, null, OWN);
    assert.equal(calls.length, 1);
  });

  it('create works for managing and legacy (flag not stored) tenants', async () => {
    const calls = [];
    Customer.create = async (d) => { calls.push(d); return { _id: ID, ...d }; };
    Sedes.create = async (d) => ({ _id: 's1', ...d });
    Servicios.create = async (d) => ({ _id: 'sv1', ...d });
    await customerService.create(payload(), TENANT, null, MANAGING);
    await customerService.create(payload(), TENANT, null, LEGACY);
    assert.equal(calls.length, 2);
  });

  function stubUpdate(doc) {
    const state = { saved: false };
    Customer.findOne = async () => doc;
    Customer.findOneAndUpdate = async () => { state.saved = true; return { _id: doc._id }; };
    return state;
  }

  it('update of a kind=customer is 403 for a non-managing tenant and nothing is written', async () => {
    const state = stubUpdate({ _id: ID, kind: 'customer' });
    await assert.rejects(() => customerService.update(ID, { Ciudad: 'Cali' }, TENANT, null, OWN, { organizationCustomerId: ORG }), denied);
    assert.equal(state.saved, false);
  });

  it('update of the organization customer is allowed (system-managed, "Mi información")', async () => {
    const state = stubUpdate({ _id: ORG, kind: 'customer' });
    await customerService.update(ORG, { Ciudad: 'Cali' }, TENANT, null, OWN, { organizationCustomerId: ORG });
    assert.equal(state.saved, true);
  });

  it('update of a provider is never gated; managing tenants and callers without capabilities update customers', async () => {
    let state = stubUpdate({ _id: ID, kind: 'provider' });
    await customerService.update(ID, { Ciudad: 'Cali' }, TENANT, null, OWN, {});
    assert.equal(state.saved, true);
    state = stubUpdate({ _id: ID, kind: 'customer' });
    await customerService.update(ID, { Ciudad: 'Cali' }, TENANT, null, MANAGING, {});
    assert.equal(state.saved, true);
    state = stubUpdate({ _id: ID, kind: 'customer' });
    await customerService.update(ID, { Ciudad: 'Cali' }, TENANT);
    assert.equal(state.saved, true);
  });

  it('delete: kind=customer (even the organization one) is 403 for a non-managing tenant; providers are allowed', async () => {
    let updated = false;
    Customer.findOne = async () => ({ _id: ID, kind: 'customer' });
    Customer.findOneAndUpdate = async () => { updated = true; return { _id: ID }; };
    await assert.rejects(() => customerService.delete(ID, TENANT, OWN), denied);
    assert.equal(updated, false);
    Customer.findOne = async () => ({ _id: ID, kind: 'provider' });
    await customerService.delete(ID, TENANT, OWN);
    assert.equal(updated, true);
  });
});
