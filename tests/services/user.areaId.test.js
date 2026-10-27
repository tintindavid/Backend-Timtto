/**
 * requisiciones-e1-base-aprobacion, tasks 3.5 / 3.6: `areaId` on users, only through users:update.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { userService } from '../../src/services/user.service.js';
import { User } from '../../src/models/user.model.js';
import { Area } from '../../src/models/area.model.js';
import { updateUserDto } from '../../src/dtos/updateUser.dto.js';
import { createUserDto } from '../../src/dtos/createUser.dto.js';
import { areaService } from '../../src/services/area.service.js';
import { userController } from '../../src/controllers/user.controller.js';
import { stubModel } from '../helpers/memoryModel.js';

const AREA = 'a'.repeat(24);
let areas;
let updates;
let currentAreaId;
let restoreAreas;
const saved = {};

beforeEach(() => {
  areas = [
    { _id: AREA, tenantId: 'acme', activa: true },
    { _id: 'b'.repeat(24), tenantId: 'acme', activa: false },
    { _id: 'c'.repeat(24), tenantId: 'globex', activa: true },
  ];
  updates = [];
  currentAreaId = null;
  restoreAreas = stubModel(Area, areas);
  saved.fou = User.findOneAndUpdate;
  saved.fo = User.findOne;
  User.findOne = () => ({ select: () => ({ lean: async () => ({ areaId: currentAreaId }) }) });
  User.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return { _id: filter._id, ...update.$set };
  };
});
afterEach(() => {
  restoreAreas();
  User.findOneAndUpdate = saved.fou;
  User.findOne = saved.fo;
});

describe('userService.update with areaId', () => {
  it('assigns an active area of the tenant (scenario: Asignar área)', async () => {
    const u = await userService.update('user-1', { tenantId: 'acme', areaId: AREA }, 'admin-1');
    assert.equal(u.areaId, AREA);
    assert.deepEqual(updates[0].filter, { _id: 'user-1', tenantId: 'acme' });
    assert.equal(updates[0].update.$set.areaId, AREA);
  });

  it('400 AREA_INVALIDA for an inactive, unknown or foreign area and nothing is written', async () => {
    for (const areaId of ['b'.repeat(24), 'c'.repeat(24), 'd'.repeat(24)]) {
      await assert.rejects(() => userService.update('user-1', { tenantId: 'acme', areaId }, 'admin-1'), { statusCode: 400, code: 'AREA_INVALIDA' });
    }
    assert.equal(updates.length, 0);
  });

  it('null removes the area', async () => {
    const u = await userService.update('user-1', { tenantId: 'acme', areaId: null }, 'admin-1');
    assert.equal(u.areaId, null);
  });

  it('403 when a user changes their own area (scenario: Autoedición)', async () => {
    await assert.rejects(
      () => userService.update('user-1', { tenantId: 'acme', areaId: AREA }, 'user-1'),
      { statusCode: 403, code: 'AREA_SELF_ASSIGN_FORBIDDEN' },
    );
    currentAreaId = AREA;
    await assert.rejects(
      () => userService.update('user-1', { tenantId: 'acme', areaId: null }, 'user-1'),
      { statusCode: 403, code: 'AREA_SELF_ASSIGN_FORBIDDEN' },
    );
    assert.equal(updates.length, 0);
  });

  it('re-sending the SAME own area (or null -> null) is allowed: the own-user form always sends areaId', async () => {
    currentAreaId = null;
    const a = await userService.update('user-1', { tenantId: 'acme', areaId: null, phone: '1' }, 'user-1');
    assert.equal(a.areaId, null);
    currentAreaId = AREA;
    const b = await userService.update('user-1', { tenantId: 'acme', areaId: AREA, phone: '2' }, 'user-1');
    assert.equal(b.areaId, AREA);
    assert.equal(updates.length, 2);
  });

  it('a self edit of other fields is unaffected', async () => {
    const u = await userService.update('user-1', { tenantId: 'acme', phone: '300' }, 'user-1');
    assert.equal(u.phone, '300');
  });

  it('the controller passes the authenticated user as the actor', async () => {
    const calls = [];
    const original = userService.update;
    userService.update = async (...args) => { calls.push(args); return { _id: args[0] }; };
    try {
      const res = { status() { return this; }, json(b) { this.body = b; return this; } };
      await userController.update(
        { params: { id: 'user-1' }, body: { areaId: AREA }, tenantId: 'acme', user: { userId: 'user-1' } },
        res,
        (e) => { throw e; },
      );
      assert.equal(calls[0][2], 'user-1');
      assert.equal(calls[0][1].tenantId, 'acme');
    } finally {
      userService.update = original;
    }
  });
});

describe('user DTOs and area helper', () => {
  it('updateUserDto and createUserDto accept areaId (hex or null) and reject anything else', () => {
    assert.equal(updateUserDto.validate({ areaId: AREA }).error, undefined);
    assert.equal(updateUserDto.validate({ areaId: null }).error, undefined);
    assert.ok(updateUserDto.validate({ areaId: 'nope' }).error);
    const base = { firstName: 'A', lastName: 'B', email: 'a@b.co' };
    assert.equal(createUserDto.validate({ ...base, areaId: AREA }).error, undefined);
    assert.equal(createUserDto.validate({ ...base, areaId: null }).error, undefined);
    assert.equal(createUserDto.validate(base).error, undefined);
    assert.ok(createUserDto.validate({ ...base, areaId: 'nope' }).error);
  });

  it('areaService.assertAreaActiva is the single check requisitions will reuse', async () => {
    assert.ok(await areaService.assertAreaActiva('acme', AREA));
    await assert.rejects(() => areaService.assertAreaActiva('acme', 'b'.repeat(24)), { code: 'AREA_INVALIDA' });
  });
});

describe('userService.create with areaId', () => {
  let created;
  let savedCreate;
  let savedFindOne;

  beforeEach(() => {
    created = [];
    savedCreate = User.create;
    savedFindOne = User.findOne;
    User.findOne = async () => null; // no duplicate email
    User.create = async (payload) => {
      created.push(payload);
      const doc = { _id: 'new-user', ...payload };
      return { ...doc, toObject: () => doc, toJSON: () => doc };
    };
  });
  afterEach(() => {
    User.create = savedCreate;
    User.findOne = savedFindOne;
  });

  const base = { tenantId: 'acme', firstName: 'A', lastName: 'B', email: 'a@b.co', password: 'longenough1' };

  it('creates the user assigned to an active area of the tenant', async () => {
    await userService.create({ ...base, areaId: AREA });
    assert.equal(created[0].areaId, AREA);
  });

  it('400 AREA_INVALIDA for an inactive, unknown or foreign area and nothing is created', async () => {
    for (const areaId of ['b'.repeat(24), 'c'.repeat(24), 'd'.repeat(24)]) {
      await assert.rejects(() => userService.create({ ...base, areaId }), { statusCode: 400, code: 'AREA_INVALIDA' });
    }
    assert.equal(created.length, 0);
  });

  it('null or empty areaId creates the user without an area', async () => {
    await userService.create({ ...base, areaId: null });
    await userService.create({ ...base, email: 'c@d.co', areaId: '' });
    assert.equal('areaId' in created[0], false);
    assert.equal('areaId' in created[1], false);
  });
});
