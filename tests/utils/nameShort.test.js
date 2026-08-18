/**
 * tests/utils/nameShort.test.js
 *
 * Unit tests for nameShort() (ot-responsables-programacion-trazable,
 * tasks.md 7.3) — pure function, no mocking needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nameShort } from '../../src/utils/nameShort.util.js';

describe('nameShort', () => {
  it('formats firstName + lastName as "M. Duran"', () => {
    assert.equal(nameShort({ firstName: 'Martin', lastName: 'Duran' }), 'M. Duran');
  });

  it('uses only the first word of a compound last name', () => {
    assert.equal(nameShort({ firstName: 'Martin', lastName: 'Duran Martinez' }), 'M. Duran');
  });

  it('falls back to the email local-part when firstName is missing', () => {
    assert.equal(nameShort({ email: 'jdoe@timtto.com' }), 'jdoe');
  });

  it('returns "?" when nothing usable is present', () => {
    assert.equal(nameShort({}), '?');
    assert.equal(nameShort(undefined), '?');
  });

  it('handles firstName without lastName', () => {
    assert.equal(nameShort({ firstName: 'Martin' }), 'M.');
  });
});
