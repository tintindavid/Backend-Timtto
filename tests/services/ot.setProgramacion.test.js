/**
 * tests/services/ot.setProgramacion.test.js
 *
 * Unit tests for oTService.setProgramacion() (ot-responsables-programacion-trazable,
 * tasks.md 7.1, design.md D4/D9/D10). DB-free — Mongoose statics and the
 * notification bus are monkey-patched (same convention as
 * tests/services/notificationRule.service.test.js).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { oTService } from '../../src/services/ot.service.js';
import { OT } from '../../src/models/ot.model.js';
import { User } from '../../src/models/user.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { notificationService } from '../../src/services/notification.service.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT = 'tenant-a';
const OT_ID = '507f1f77bcf86cd799439010';
const USER_A = '507f1f77bcf86cd799439021';
const USER_B = '507f1f77bcf86cd799439022';
const FOREIGN_USER = '507f1f77bcf86cd799439099';
const ADMIN_ACTOR = { userId: '507f1f77bcf86cd799439001', firstName: 'Martin', lastName: 'Duran' };

const TODAY = new Date();
const FUTURE_START = new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const FUTURE_END = new Date(TODAY.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const PAST_DATE = '2020-01-01';

function eligibleUser(id, extra = {}) {
  return { _id: id, tenantId: TENANT, isDeleted: false, roleId: { permissions: ['ots:can-be-responsible'] }, firstName: 'Test', lastName: 'User', ...extra };
}

function mockOt(overrides = {}) {
  return {
    _id: OT_ID,
    tenantId: TENANT,
    ClienteId: null,
    Consecutivo: 'OT-000001',
    programaciones: [],
    ...overrides,
  };
}

function stubUserFind(users) {
  User.find = () => ({ populate: () => ({ lean: () => Promise.resolve(users) }) });
}

describe('oTService.setProgramacion', () => {
  beforeEach(() => {
    // Default no-op for the state-transition OT.updateOne. Tests that need
    // to inspect the transition can reassign after this runs.
    OT.updateOne = async () => ({ modifiedCount: 1 });
  });

  afterEach(() => {
    delete OT.findOne;
    delete OT.bulkWrite;
    delete OT.updateOne;
    delete User.find;
    delete Customer.findById;
    delete notificationService.emit;
  });

  // setProgramacion issues a follow-up OT.updateOne to elevate EstadoOt:
  // Pendiente → Programada. Every test needs a no-op stub so it doesn't
  // hit real Mongo. Individual tests may override if they need to assert
  // on the transition.
  function stubOtUpdateOneNoop() {
    OT.updateOne = async () => ({ modifiedCount: 1 });
  }

  it('happy path: pushes a new active entry and flips the previous one via arrayFilters', async () => {
    OT.findOne = async () => mockOt();
    stubUserFind([eligibleUser(USER_A)]);
    let bulkOps = null;
    OT.bulkWrite = async (ops, options) => {
      bulkOps = { ops, options };
      return { modifiedCount: 1 };
    };
    notificationService.emit = async () => ({ dispatched: 0 });

    const entry = await oTService.setProgramacion({
      otId: OT_ID,
      tenantId: TENANT,
      fechaInicio: FUTURE_START,
      fechaFin: FUTURE_END,
      responsableUserIds: [USER_A],
      actor: ADMIN_ACTOR,
    });

    assert.equal(entry.isActive, true);
    assert.equal(entry.createdBy, ADMIN_ACTOR.userId);
    assert.equal(entry.createdByName, 'M. Duran');
    assert.deepEqual(entry.responsables, [{ userId: USER_A, snapshotName: 'T. User' }]);
    // First-ever programación (no previous active) → single $push op only.
    // The flip op is only added when reprogramming (see other test cases).
    // MongoDB would fail with "path must exist" if we tried to $set on
    // `programaciones.$[...]` when the field has never been written.
    assert.equal(bulkOps.options.ordered, true);
    assert.equal(bulkOps.ops.length, 1);
    assert.deepEqual(bulkOps.ops[0].updateOne.filter, { _id: OT_ID, tenantId: TENANT });
    assert.deepEqual(bulkOps.ops[0].updateOne.update.$push.programaciones, entry);
  });

  it('reprogramación includes both flip + push ops (2-step atomic bulkWrite)', async () => {
    OT.findOne = async () => mockOt({
      programaciones: [
        { isActive: true, fechaInicio: new Date(FUTURE_START), fechaFin: new Date(FUTURE_END), responsables: [{ userId: USER_A, snapshotName: 'A' }] },
      ],
    });
    stubUserFind([eligibleUser(USER_A), eligibleUser(USER_B)]);
    let bulkOps = null;
    OT.bulkWrite = async (ops, options) => {
      bulkOps = { ops, options };
      return { modifiedCount: 1 };
    };
    notificationService.emit = async () => ({ dispatched: 0 });

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A, USER_B], actor: ADMIN_ACTOR,
    });

    assert.equal(bulkOps.options.ordered, true);
    assert.equal(bulkOps.ops.length, 2);
    const [flipOp, pushOp] = bulkOps.ops;
    assert.equal(flipOp.updateOne.update.$set['programaciones.$[active].isActive'], false);
    assert.deepEqual(flipOp.updateOne.arrayFilters, [{ 'active.isActive': true }]);
    assert.ok(pushOp.updateOne.update.$push.programaciones);
  });

  it('elevates EstadoOt Pendiente → Programada on first programación', async () => {
    OT.findOne = async () => mockOt({ EstadoOt: 'Pendiente' });
    stubUserFind([eligibleUser(USER_A)]);
    OT.bulkWrite = async () => ({ modifiedCount: 1 });
    let stateUpdate = null;
    OT.updateOne = async (filter, update) => {
      stateUpdate = { filter, update };
      return { modifiedCount: 1 };
    };
    notificationService.emit = async () => ({ dispatched: 0 });

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A], actor: ADMIN_ACTOR,
    });

    assert.ok(stateUpdate, 'OT.updateOne must be invoked for the state transition');
    assert.deepEqual(stateUpdate.filter, { _id: OT_ID, tenantId: TENANT });
    assert.equal(stateUpdate.update.$set.EstadoOt, 'Programada');
  });

  it('does NOT downgrade EstadoOt En Progreso when reprogramming', async () => {
    OT.findOne = async () => mockOt({
      EstadoOt: 'En Progreso',
      programaciones: [
        { isActive: true, fechaInicio: new Date(FUTURE_START), fechaFin: new Date(FUTURE_END), responsables: [{ userId: USER_A, snapshotName: 'A' }] },
      ],
    });
    stubUserFind([eligibleUser(USER_A), eligibleUser(USER_B)]);
    OT.bulkWrite = async () => ({ modifiedCount: 1 });
    let stateUpdateCalled = false;
    OT.updateOne = async () => { stateUpdateCalled = true; return { modifiedCount: 1 }; };
    notificationService.emit = async () => ({ dispatched: 0 });

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A, USER_B], actor: ADMIN_ACTOR,
    });

    assert.equal(stateUpdateCalled, false, 'must NOT overwrite advanced state');
  });

  it('rejects fechaFin <= fechaInicio with 400 VALIDATION_ERROR, no write', async () => {
    OT.findOne = async () => mockOt();
    let updateCalled = false;
    OT.bulkWrite = async () => { updateCalled = true; };

    let thrown = null;
    try {
      await oTService.setProgramacion({
        otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_END, fechaFin: FUTURE_START,
        responsableUserIds: [USER_A], actor: ADMIN_ACTOR,
      });
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 400);
    assert.equal(thrown.code, 'VALIDATION_ERROR');
    assert.equal(updateCalled, false);
  });

  it('rejects a new programación whose fechaInicio is in the past with 400 START_DATE_IN_PAST', async () => {
    OT.findOne = async () => mockOt(); // no previous active entry
    let updateCalled = false;
    OT.bulkWrite = async () => { updateCalled = true; };

    let thrown = null;
    try {
      await oTService.setProgramacion({
        otId: OT_ID, tenantId: TENANT, fechaInicio: PAST_DATE, fechaFin: FUTURE_END,
        responsableUserIds: [USER_A], actor: ADMIN_ACTOR,
      });
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 400);
    assert.equal(thrown.code, 'START_DATE_IN_PAST');
    assert.equal(updateCalled, false);
  });

  it('preserves an unchanged past fechaInicio when it matches the active entry', async () => {
    OT.findOne = async () => mockOt({
      programaciones: [
        { isActive: true, fechaInicio: new Date(PAST_DATE), fechaFin: new Date('2020-01-31'), responsables: [{ userId: USER_A, snapshotName: 'A' }] },
      ],
    });
    stubUserFind([eligibleUser(USER_A), eligibleUser(USER_B)]);
    OT.bulkWrite = async () => ({ modifiedCount: 1 });
    notificationService.emit = async () => ({ dispatched: 0 });

    const entry = await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: PAST_DATE, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A, USER_B], actor: ADMIN_ACTOR,
    });

    assert.equal(entry.fechaInicio.toISOString().slice(0, 10), PAST_DATE);
  });

  it('rejects a foreign-tenant userId with 400 INVALID_RESPONSABLE_USER_IDS', async () => {
    OT.findOne = async () => mockOt();
    stubUserFind([eligibleUser(USER_A)]); // FOREIGN_USER not returned by User.find
    let updateCalled = false;
    OT.bulkWrite = async () => { updateCalled = true; };

    let thrown = null;
    try {
      await oTService.setProgramacion({
        otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
        responsableUserIds: [USER_A, FOREIGN_USER], actor: ADMIN_ACTOR,
      });
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 400);
    assert.equal(thrown.code, 'INVALID_RESPONSABLE_USER_IDS');
    assert.deepEqual(thrown.details.foreignUserIds, [FOREIGN_USER]);
    assert.equal(updateCalled, false);
  });

  it('rejects a user whose role lacks ots:can-be-responsible with 400 INELIGIBLE_RESPONSABLES', async () => {
    OT.findOne = async () => mockOt();
    stubUserFind([
      eligibleUser(USER_A),
      { _id: USER_B, tenantId: TENANT, isDeleted: false, roleId: { permissions: ['reports:update'] } },
    ]);
    let updateCalled = false;
    OT.bulkWrite = async () => { updateCalled = true; };

    let thrown = null;
    try {
      await oTService.setProgramacion({
        otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
        responsableUserIds: [USER_A, USER_B], actor: ADMIN_ACTOR,
      });
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 400);
    assert.equal(thrown.code, 'INELIGIBLE_RESPONSABLES');
    assert.deepEqual(thrown.details.ineligibleUserIds, [USER_B]);
    assert.equal(updateCalled, false);
  });

  it('rejects an empty roster with 400 VALIDATION_ERROR', async () => {
    OT.findOne = async () => mockOt();
    let thrown = null;
    try {
      await oTService.setProgramacion({
        otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
        responsableUserIds: [], actor: ADMIN_ACTOR,
      });
    } catch (err) { thrown = err; }
    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 400);
    assert.equal(thrown.code, 'VALIDATION_ERROR');
  });

  it('notifies only newly-added userIds vs. the previous active roster', async () => {
    OT.findOne = async () => mockOt({
      programaciones: [
        { isActive: true, fechaInicio: new Date(FUTURE_START), fechaFin: new Date(FUTURE_END), responsables: [{ userId: USER_A, snapshotName: 'A' }] },
      ],
    });
    stubUserFind([eligibleUser(USER_A), eligibleUser(USER_B)]);
    OT.bulkWrite = async () => ({ modifiedCount: 1 });
    const emitted = [];
    notificationService.emit = async (tenantId, event, payload, options) => {
      emitted.push({ tenantId, event, options });
      return { dispatched: 1 };
    };

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A, USER_B], actor: ADMIN_ACTOR,
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, 'ot.responsible.assigned');
    assert.deepEqual(emitted[0].options.extraRecipientUserIds, [USER_B]);
  });

  it('actor who self-assigns IS included as a responsable (receives notification)', async () => {
    OT.findOne = async () => mockOt();
    stubUserFind([eligibleUser(ADMIN_ACTOR.userId), eligibleUser(USER_A)]);
    OT.bulkWrite = async () => ({ modifiedCount: 1 });
    const emitted = [];
    notificationService.emit = async (tenantId, event, payload, options) => { emitted.push(options); return {}; };

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [ADMIN_ACTOR.userId, USER_A], actor: ADMIN_ACTOR,
    });

    // Single emit — both users are new responsables (including the actor).
    // exclude is empty because the actor self-assigned; they receive the
    // notification as a responsable, not as a role-match.
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0].extraRecipientUserIds.sort(), [ADMIN_ACTOR.userId, USER_A].sort());
    assert.deepEqual(emitted[0].excludeRecipientUserIds, []);
  });

  it('actor who does NOT self-assign is excluded from role-match notifications', async () => {
    OT.findOne = async () => mockOt();
    stubUserFind([eligibleUser(USER_A)]);
    OT.bulkWrite = async () => ({ modifiedCount: 1 });
    const emitted = [];
    notificationService.emit = async (tenantId, event, payload, options) => { emitted.push(options); return {}; };

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A], actor: ADMIN_ACTOR,
    });

    // Actor is excluded via excludeRecipientUserIds so their admin role
    // in the rule does not backfire and notify them of their own action.
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0].extraRecipientUserIds, [USER_A]);
    assert.deepEqual(emitted[0].excludeRecipientUserIds, [ADMIN_ACTOR.userId]);
  });

  it('date-only reprogramming (same roster) dispatches zero notifications but still writes the entry', async () => {
    OT.findOne = async () => mockOt({
      programaciones: [
        { isActive: true, fechaInicio: new Date('2026-01-01'), fechaFin: new Date('2026-01-31'), responsables: [{ userId: USER_A, snapshotName: 'A' }] },
      ],
    });
    stubUserFind([eligibleUser(USER_A)]);
    let updateCalled = false;
    OT.bulkWrite = async () => { updateCalled = true; return { modifiedCount: 1 }; };
    let emitCalled = false;
    notificationService.emit = async () => { emitCalled = true; return {}; };

    await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A], actor: ADMIN_ACTOR,
    });

    assert.equal(updateCalled, true, 'entry must still be persisted for audit history');
    assert.equal(emitCalled, false);
  });

  it('a notification bus failure does not abort the write', async () => {
    OT.findOne = async () => mockOt();
    stubUserFind([eligibleUser(USER_A)]);
    let updateCalled = false;
    OT.bulkWrite = async () => { updateCalled = true; return { modifiedCount: 1 }; };
    notificationService.emit = async () => { throw new Error('bus down'); };

    const entry = await oTService.setProgramacion({
      otId: OT_ID, tenantId: TENANT, fechaInicio: FUTURE_START, fechaFin: FUTURE_END,
      responsableUserIds: [USER_A], actor: ADMIN_ACTOR,
    });

    assert.equal(updateCalled, true);
    assert.equal(entry.isActive, true);
  });
});
