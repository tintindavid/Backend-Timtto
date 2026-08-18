/**
 * tests/utils/otResponsibility.test.js
 *
 * Unit tests for computeCanWork() / assertUserCanWork()
 * (ot-responsables-programacion-trazable, tasks.md 7.2, design.md D6/D7).
 * Pure functions — no DB mocking needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeCanWork, assertUserCanWork } from '../../src/utils/otResponsibility.util.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const USER_A = { userId: '507f1f77bcf86cd799439021' };
const USER_B = { userId: '507f1f77bcf86cd799439022' };
const ADMIN = { userId: '507f1f77bcf86cd799439099', role: 'admin' };

function otWithActiveRoster(userIds) {
  return {
    programaciones: [
      {
        isActive: true,
        responsables: userIds.map((userId) => ({ userId, snapshotName: `Snap ${userId}` })),
      },
    ],
  };
}

describe('computeCanWork', () => {
  it('is permissive when the OT has no programaciones (retro-compat)', () => {
    assert.equal(computeCanWork(USER_A, { programaciones: [] }), true);
    assert.equal(computeCanWork(USER_A, {}), true);
  });

  it('is permissive when no entry is active', () => {
    const ot = { programaciones: [{ isActive: false, responsables: [{ userId: USER_A.userId, snapshotName: 'A' }] }] };
    assert.equal(computeCanWork(USER_A, ot), true);
  });

  it('returns true when the user is in the active roster', () => {
    const ot = otWithActiveRoster([USER_A.userId, USER_B.userId]);
    assert.equal(computeCanWork(USER_A, ot), true);
  });

  it('returns false when the user is NOT in the active roster', () => {
    const ot = otWithActiveRoster([USER_B.userId]);
    assert.equal(computeCanWork(USER_A, ot), false);
  });

  it('superadmin/admin do NOT bypass — false when not in the roster', () => {
    const ot = otWithActiveRoster([USER_B.userId]);
    assert.equal(computeCanWork(ADMIN, ot), false);
  });
});

describe('assertUserCanWork', () => {
  it('does not throw when the OT has no active programación', () => {
    assert.doesNotThrow(() => assertUserCanWork(USER_A, { programaciones: [] }));
  });

  it('does not throw when the user is in the active roster', () => {
    const ot = otWithActiveRoster([USER_A.userId]);
    assert.doesNotThrow(() => assertUserCanWork(USER_A, ot));
  });

  it('throws 403 NOT_RESPONSIBLE with details.responsables when the user is not in the roster', () => {
    const ot = otWithActiveRoster([USER_B.userId]);
    let thrown = null;
    try {
      assertUserCanWork(USER_A, ot);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 403);
    assert.equal(thrown.code, 'NOT_RESPONSIBLE');
    assert.deepEqual(thrown.details.responsables, [{ userId: USER_B.userId, name: `Snap ${USER_B.userId}` }]);
  });
});
