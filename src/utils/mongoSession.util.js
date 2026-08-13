'use strict';
import { logger } from '../config/logger.config.js';

/**
 * MongoServerError code 20 = IllegalOperation, raised when the connected
 * server is a standalone mongod without transaction support. Atlas +
 * production always run as a replica set / mongos and this fallback never
 * triggers there; it only matters for local dev.
 */
const TRANSACTIONS_UNSUPPORTED_CODE = 20;

// One-shot log per process so we don't spam the dev console every request.
let warnedOnce = false;

/**
 * Runs `fn(session)` inside a MongoDB transaction when the connection
 * supports it, and re-runs `fn(null)` outside a transaction when the server
 * returns code 20 (`IllegalOperation` / "Transaction numbers are only
 * allowed on a replica set member or mongos").
 *
 * Contract for `fn`:
 *   - MUST accept a `session` argument (may be `null`).
 *   - When `session` is null, do NOT pass a session to any Mongoose call.
 *   - MUST be idempotent-safe under retry: if a partial write from the
 *     failed transactional attempt might have landed, `fn(null)` should
 *     either produce the same net effect or short-circuit. In practice this
 *     is safe because `withTransaction` aborts the txn before throwing so
 *     no partial writes persist on the code-20 error.
 *
 * @param {import('mongoose').ClientSession} session — Mongoose session
 * @param {(session: import('mongoose').ClientSession | null) => Promise<any>} fn
 * @returns Whatever `fn` returns.
 */
export async function runWithTransactionFallback(session, fn) {
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const code = err?.code ?? err?.errorResponse?.code;
    if (code !== TRANSACTIONS_UNSUPPORTED_CODE) throw err;
    if (!warnedOnce) {
      warnedOnce = true;
      logger.warn(
        'mongoSession: transactions not supported on this connection; falling back to non-transactional path. ' +
          'This is expected on standalone dev MongoDB and MUST NOT be seen in production (Atlas is a replica set).'
      );
    }
    return fn(null);
  }
}

export default runWithTransactionFallback;
