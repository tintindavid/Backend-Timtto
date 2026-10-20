/**
 * tests/utils/verificationParams.util.test.js
 * reportes-externos-mp-mc, task 1.3 / 4.2. Pure function; also fixes the equivalence with the rules of
 * `reportService.updateVerificationParams` that this util mirrors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVerificationParams, MAX_VERIFICATION_ROWS } from '../../src/utils/verificationParams.util.js';
import { MAX_MAGNITUD_LENGTH, MAX_UNIDAD_LENGTH, MAX_PATRON_LENGTH } from '../../src/constants/verificationParam.constants.js';

describe('sanitizeVerificationParams', () => {
  it('trims text and turns numeric strings into numbers', () => {
    assert.deepEqual(
      sanitizeVerificationParams([{ magnitud: '  Presion ', unidad: ' mmHg ', valorReferencia: '120', valorMedido: 118.5, patron: ' Fluke ' }]),
      [{ magnitud: 'Presion', unidad: 'mmHg', valorReferencia: 120, valorMedido: 118.5, patron: 'Fluke' }],
    );
  });

  it('accepts a decimal comma', () => {
    assert.equal(sanitizeVerificationParams([{ magnitud: 'x', valorMedido: '12,5' }])[0].valorMedido, 12.5);
  });

  it('keeps zero and negative values', () => {
    const [row] = sanitizeVerificationParams([{ magnitud: 'x', valorReferencia: 0, valorMedido: '-3' }]);
    assert.equal(row.valorReferencia, 0);
    assert.equal(row.valorMedido, -3);
  });

  it('an empty string or null is "no value", never zero', () => {
    const [row] = sanitizeVerificationParams([{ magnitud: 'x', valorReferencia: '', valorMedido: null }]);
    assert.equal(row.valorReferencia, null);
    assert.equal(row.valorMedido, null);
  });

  it('drops rows with nothing in them', () => {
    assert.deepEqual(sanitizeVerificationParams([{}, { magnitud: ' ', unidad: 'mmHg' }, { magnitud: 'ok' }]).map((r) => r.magnitud), ['ok']);
  });

  it('a row with only a unit is dropped (same as the existing endpoint)', () => {
    assert.equal(sanitizeVerificationParams([{ unidad: 'mmHg' }]).length, 0);
  });

  it('returns an empty list for anything that is not an array', () => {
    assert.deepEqual(sanitizeVerificationParams(undefined), []);
    assert.deepEqual(sanitizeVerificationParams(null), []);
    assert.deepEqual(sanitizeVerificationParams('x'), []);
  });

  it('rejects non numeric values with 400', () => {
    for (const bad of ['abc', 'NaN', 'Infinity', '1e999x']) {
      assert.throws(() => sanitizeVerificationParams([{ magnitud: 'x', valorMedido: bad }]), (e) => e.statusCode === 400, bad);
    }
  });

  it('rejects texts over the field limits', () => {
    assert.throws(() => sanitizeVerificationParams([{ magnitud: 'x'.repeat(MAX_MAGNITUD_LENGTH + 1) }]), (e) => e.statusCode === 400);
    assert.throws(() => sanitizeVerificationParams([{ magnitud: 'x', unidad: 'u'.repeat(MAX_UNIDAD_LENGTH + 1) }]), (e) => e.statusCode === 400);
    assert.throws(() => sanitizeVerificationParams([{ magnitud: 'x', patron: 'p'.repeat(MAX_PATRON_LENGTH + 1) }]), (e) => e.statusCode === 400);
    assert.doesNotThrow(() => sanitizeVerificationParams([{ magnitud: 'x'.repeat(MAX_MAGNITUD_LENGTH) }]));
  });

  it('rejects more rows than the limit', () => {
    const rows = Array.from({ length: MAX_VERIFICATION_ROWS + 1 }, () => ({ magnitud: 'x' }));
    assert.throws(() => sanitizeVerificationParams(rows), (e) => e.statusCode === 400);
    assert.equal(sanitizeVerificationParams(rows.slice(1)).length, MAX_VERIFICATION_ROWS);
  });

  it('does not copy unexpected fields', () => {
    const [row] = sanitizeVerificationParams([{ magnitud: 'x', _id: 'abc', isAdmin: true }]);
    assert.deepEqual(Object.keys(row).sort(), ['magnitud', 'patron', 'unidad', 'valorMedido', 'valorReferencia']);
  });
});
