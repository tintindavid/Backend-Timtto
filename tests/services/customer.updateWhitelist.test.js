/**
 * Adversarial fix (managesCustomers #1): customerService.update must not write the raw body.
 * DB-free (model statics stubbed). The real-Mongo exploit run lives in tests/integration/ownCustomer.mongo.integration.test.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { customerService, sanitizeCustomerUpdate } from '../../src/services/customer.service.js';
import { Customer } from '../../src/models/customer.model.js';

const TENANT = 'clinic';
const ORG = '507f1f77bcf86cd799439002';
const OWN = { executesServices: true, registersExternal: false, managesCustomers: false };

describe('customerService.update body whitelist', () => {
  afterEach(() => { delete Customer.findOne; delete Customer.findOneAndUpdate; });

  function stub() {
    const state = { updates: [] };
    Customer.findOne = async () => ({ _id: ORG, kind: 'customer' });
    Customer.findOneAndUpdate = async (_f, u) => { state.updates.push(u); return { _id: ORG }; };
    return state;
  }

  it('the exploit PUT {isDeleted:true} on the organization customer is 400 and nothing is written', async () => {
    const state = stub();
    await assert.rejects(
      () => customerService.update(ORG, { isDeleted: true }, TENANT, null, OWN, { organizationCustomerId: ORG }),
      (e) => e.statusCode === 400 && e.code === 'VALIDATION_ERROR' && e.details?.fields?.includes('isDeleted'),
    );
    assert.equal(state.updates.length, 0);
  });

  for (const key of ['isDeleted', 'deletedAt', 'tenantId', '_id', 'createdAt', 'unknownField']) {
    it(`rejects ${key} even next to legitimate fields`, async () => {
      const state = stub();
      await assert.rejects(
        () => customerService.update(ORG, { Ciudad: 'Cali', [key]: 'x' }, TENANT, null, OWN, { organizationCustomerId: ORG }),
        (e) => e.statusCode === 400 && e.code === 'VALIDATION_ERROR',
      );
      assert.equal(state.updates.length, 0);
    });
  }

  it('rejects nested objects (operator injection) on business fields', () => {
    assert.throws(() => sanitizeCustomerUpdate({ Nit: { $gt: 0 } }), (e) => e.statusCode === 400);
    assert.throws(() => sanitizeCustomerUpdate({ correousados: [{ a: 1 }] }), (e) => e.statusCode === 400);
  });

  it('kind is dropped silently (immutable, long-standing contract) and never reaches the $set', async () => {
    const state = stub();
    await customerService.update(ORG, { Ciudad: 'Cali', kind: 'provider' }, TENANT, null, OWN, { organizationCustomerId: ORG });
    assert.deepEqual(state.updates[0], { $set: { Ciudad: 'Cali' } });
  });

  it('regression: the normal edit payload of CustomerFormPage (multipart strings) still works', async () => {
    const state = stub();
    const body = Object.assign(Object.create(null), {
      Razonsocial: 'Acme', Ciudad: 'Bogota', Departamento: 'Cundinamarca', Email: 'a@acme.com', Nit: '900123',
      Direccion: 'Calle 1', TelContacto: '3001234567', UserContacto: 'Ana Perez',
    });
    await customerService.update(ORG, body, TENANT, null, OWN, { organizationCustomerId: ORG });
    assert.deepEqual(state.updates[0], { $set: { ...body } });
  });

  it('does not mutate the caller body', () => {
    const body = { Ciudad: 'Cali', kind: 'provider' };
    sanitizeCustomerUpdate(body);
    assert.deepEqual(body, { Ciudad: 'Cali', kind: 'provider' });
  });
});
