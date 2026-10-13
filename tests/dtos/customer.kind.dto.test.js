/**
 * tests/dtos/customer.kind.dto.test.js
 * terceros-customers-providers, tasks 3.1 / 3.2.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { queryCustomerDto } from '../../src/dtos/queryCustomer.dto.js';
import { createCustomerDto } from '../../src/dtos/createCustomer.dto.js';
import { updateCustomerDto } from '../../src/dtos/updateCustomer.dto.js';

describe('queryCustomerDto kind', () => {
  it('defaults to customer', () => {
    const { error, value } = queryCustomerDto.validate({});
    assert.equal(error, undefined);
    assert.equal(value.kind, 'customer');
  });

  it('accepts customer, provider and all', () => {
    for (const kind of ['customer', 'provider', 'all']) {
      const { error, value } = queryCustomerDto.validate({ kind });
      assert.equal(error, undefined);
      assert.equal(value.kind, kind);
    }
  });

  it('rejects an unknown kind', () => {
    const { error } = queryCustomerDto.validate({ kind: 'x' });
    assert.ok(error);
  });
});

describe('createCustomerDto kind', () => {
  const base = { Razonsocial: 'A', Ciudad: 'B', Departamento: 'C', Email: 'a@b.com', Nit: 1 };

  it('kind is optional', () => {
    assert.equal(createCustomerDto.validate(base).error, undefined);
  });

  it('accepts provider and rejects an unknown kind', () => {
    assert.equal(createCustomerDto.validate({ ...base, kind: 'provider' }).error, undefined);
    assert.ok(createCustomerDto.validate({ ...base, kind: 'supplier' }).error);
  });
});

describe('updateCustomerDto kind', () => {
  it('strips kind from the payload', () => {
    const { error, value } = updateCustomerDto.validate({ Razonsocial: 'X', kind: 'provider' });
    assert.equal(error, undefined);
    assert.equal('kind' in value, false);
  });
});
