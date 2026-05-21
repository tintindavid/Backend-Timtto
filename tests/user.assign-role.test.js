import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { userService } from '../src/services/user.service.js';
import { Role } from '../src/models/role.model.js';
import { User } from '../src/models/user.model.js';

describe('userService.assignRole', () => {
  afterEach(() => {
    delete Role.findOne;
    delete User.findOneAndUpdate;
  });

  it('assigns a tenant role to an existing user', async () => {
    Role.findOne = async () => ({ _id: 'role-1', tenantId: 'tenant-1', isDeleted: false });
    User.findOneAndUpdate = async () => ({ toJSON: () => ({ _id: 'user-1', tenantId: 'tenant-1', roleId: 'role-1' }) });

    const result = await userService.assignRole('user-1', 'role-1', 'tenant-1');

    assert.equal(result.roleId, 'role-1');
  });
});