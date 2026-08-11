/**
 * tests/utils/escapeRegex.util.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { escapeRegex } from '../../src/utils/escapeRegex.util.js';

describe('escapeRegex', () => {
  it('escapes every RegExp metacharacter', () => {
    // . * + ? ^ $ { } ( ) | [ ] \
    assert.equal(
      escapeRegex('.*+?^${}()|[]\\'),
      '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\'
    );
  });

  it('passes plain alphanumerics through unchanged', () => {
    assert.equal(escapeRegex('MONITOR MULTIPARAMETRO 12'), 'MONITOR MULTIPARAMETRO 12');
  });

  it('coerces non-strings safely', () => {
    assert.equal(escapeRegex(42), '42');
  });

  it('turns a catastrophic-backtracking payload into a literal string search', () => {
    // Before the fix, `.*` would build /.*/i and match every document.
    const pattern = new RegExp(escapeRegex('.*'), 'i');
    assert.equal(pattern.test('monitor'), false, 'literal `.*` must not match arbitrary text');
    assert.equal(pattern.test('a.*b'), true, 'but does match a string containing the literal `.*`');
  });
});
