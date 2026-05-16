import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryRepuestosDto } from '../src/dtos/queryRepuestos.dto.js';

describe('queryRepuestosDto', () => {
  it('accepts clienteId when valid ObjectId', () => {
    const { error, value } = queryRepuestosDto.validate({
      page: 1,
      limit: 10,
      clienteId: '507f1f77bcf86cd799439011',
      estado: 'Solicitado',
    });

    assert.equal(error, undefined);
    assert.equal(value.clienteId, '507f1f77bcf86cd799439011');
  });

  it('rejects invalid clienteId', () => {
    const { error } = queryRepuestosDto.validate({ clienteId: 'invalid-id' });
    assert.ok(error);
  });

  it('treats blank filters as absent', () => {
    const { error, value } = queryRepuestosDto.validate({
      estado: '',
      clienteId: '',
      search: '',
    });

    assert.equal(error, undefined);
    assert.equal(value.estado, undefined);
    assert.equal(value.clienteId, undefined);
    assert.equal(value.search, undefined);
  });
});
