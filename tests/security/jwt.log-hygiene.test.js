/**
 * tests/security/jwt.log-hygiene.test.js
 * token-log-hygiene: verifyToken must never hand the token (or a long piece of it) to the logger.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { logger } from '../../src/config/logger.config.js';
import { signToken, verifyToken } from '../../src/utils/jwt.util.js';

const LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly', 'log'];
const MAX_LEAK = 8;

let captured;
const originals = {};

beforeEach(() => {
  captured = [];
  for (const level of LEVELS) {
    originals[level] = logger[level];
    logger[level] = (...args) => { captured.push(args); };
  }
});

afterEach(() => {
  for (const level of LEVELS) logger[level] = originals[level];
});

function leaks(token) {
  const dump = JSON.stringify(captured, (_k, v) => (v instanceof Error ? v.message : v));
  if (dump.includes(token)) return true;
  // Any window longer than MAX_LEAK characters of the token counts as a leak.
  for (let i = 0; i + MAX_LEAK + 1 <= token.length; i += 1) {
    if (dump.includes(token.slice(i, i + MAX_LEAK + 1))) return true;
  }
  return false;
}

describe('verifyToken log hygiene', () => {
  it('does not log a valid token', () => {
    const token = signToken({ userId: 'u1', role: 'admin', tenantId: 't1' });
    const decoded = verifyToken(token);
    assert.equal(decoded.userId, 'u1');
    assert.equal(leaks(token), false);
  });

  it('rejects an invalid token with 401 INVALID_TOKEN and does not log it', () => {
    const token = `${signToken({ userId: 'u1' })}tampered`;
    assert.throws(() => verifyToken(token), (err) => {
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, 'INVALID_TOKEN');
      return true;
    });
    assert.equal(leaks(token), false);
  });

  it('rejects garbage without logging it', () => {
    const token = 'this.is-not.a-jwt-at-all-1234567890';
    assert.throws(() => verifyToken(token));
    assert.equal(leaks(token), false);
  });
});
