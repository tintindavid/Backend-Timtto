/**
 * tests/utils/serial.util.test.js
 *
 * Shared-fixture tests for normalizeSerial/serialHasDigit
 * (equipo-duplicate-detection-and-replace, tasks.md 1.2/6.1). Iterates
 * ai-specs/fixtures/serial-normalize.fixtures.json — the same fixture the
 * frontend suite reads — so backend and frontend cannot silently drift.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeSerial, serialHasDigit } from '../../src/utils/serial.util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../../ai-specs/fixtures/serial-normalize.fixtures.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('normalizeSerial', () => {
  fixtures.normalize.forEach(({ in: input, out: expected }) => {
    it(`normalizeSerial(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeSerial(input), expected);
    });
  });

  it('returns "" for non-string input', () => {
    assert.equal(normalizeSerial(null), '');
    assert.equal(normalizeSerial(undefined), '');
    assert.equal(normalizeSerial(123), '');
  });
});

describe('serialHasDigit', () => {
  fixtures.hasDigit.forEach(({ in: input, expected }) => {
    it(`serialHasDigit(${JSON.stringify(input)}) === ${expected}`, () => {
      assert.equal(serialHasDigit(input), expected);
    });
  });
});
