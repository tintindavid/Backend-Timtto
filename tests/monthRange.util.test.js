import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, periodLabel, MONTHS } from '../src/utils/monthRange.util.js';

describe('monthRange', () => {
  it('returns single-element array when from === to', () => {
    assert.deepEqual(monthRange('feb', 'feb'), ['feb']);
  });

  it('returns correct multi-month range', () => {
    assert.deepEqual(monthRange('oct', 'dic'), ['oct', 'nov', 'dic']);
  });

  it('returns full range ene → dic', () => {
    assert.deepEqual(monthRange('ene', 'dic'), MONTHS);
  });

  it('throws on invalid from code', () => {
    assert.throws(() => monthRange('xyz', 'mar'), /Invalid month code/);
  });

  it('throws on invalid to code', () => {
    assert.throws(() => monthRange('ene', 'xyz'), /Invalid month code/);
  });

  it('throws when from > to (inverted range)', () => {
    assert.throws(() => monthRange('mar', 'ene'), /must be before or equal/);
  });
});

describe('periodLabel', () => {
  it('single month: no dash', () => {
    assert.equal(periodLabel('ene', 'ene', 2025), 'Enero 2025');
  });

  it('multi month: includes dash', () => {
    assert.equal(periodLabel('ene', 'mar', 2025), 'Enero - Marzo 2025');
  });
});
