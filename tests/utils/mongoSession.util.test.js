/**
 * tests/utils/mongoSession.util.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runWithTransactionFallback } from '../../src/utils/mongoSession.util.js';

function fakeSession(withTransactionImpl) {
  return { withTransaction: withTransactionImpl };
}

describe('runWithTransactionFallback', () => {
  it('returns the fn result when withTransaction succeeds', async () => {
    const session = fakeSession(async (fn) => { await fn(); });
    const result = await runWithTransactionFallback(session, async (sess) => {
      assert.equal(sess, session, 'fn should receive the session on the txn path');
      return 42;
    });
    assert.equal(result, 42);
  });

  it('falls back to fn(null) when the server returns code 20 (transactions unsupported)', async () => {
    const session = fakeSession(async () => {
      const err = new Error('Transaction numbers are only allowed on a replica set member or mongos');
      err.code = 20;
      throw err;
    });
    let fallbackCalledWith = 'unset';
    const result = await runWithTransactionFallback(session, async (sess) => {
      fallbackCalledWith = sess;
      return 'from-fallback';
    });
    // The second (fallback) invocation receives null
    assert.equal(fallbackCalledWith, null);
    assert.equal(result, 'from-fallback');
  });

  it('accepts code 20 nested inside errorResponse (MongoServerError shape)', async () => {
    const session = fakeSession(async () => {
      const err = new Error('IllegalOperation');
      err.errorResponse = { code: 20 };
      throw err;
    });
    let fallbackCalled = false;
    await runWithTransactionFallback(session, async (sess) => {
      if (sess === null) fallbackCalled = true;
    });
    assert.equal(fallbackCalled, true);
  });

  it('rethrows unrelated errors without falling back', async () => {
    const boom = new Error('duplicate key');
    boom.code = 11000;
    const session = fakeSession(async () => { throw boom; });
    let fallbackRan = false;
    await assert.rejects(
      runWithTransactionFallback(session, async (sess) => {
        if (sess === null) fallbackRan = true;
      }),
      /duplicate key/
    );
    assert.equal(fallbackRan, false, 'fallback must not run on non-code-20 errors');
  });
});
