import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { roleService } from '../src/services/role.service.js';
import { Role } from '../src/models/role.model.js';

describe('roleService', () => {
  afterEach(() => {
    delete Role.findOne;
    delete Role.create;
    delete Role.find;
    delete Role.countDocuments;
    delete Role.findOneAndUpdate;
  });

  it('creates a tenant-scoped role with validated permissions', async () => {
    let createdPayload = null;
    Role.findOne = async () => null;
    Role.create = async (payload) => {
      createdPayload = payload;
      return { toJSON: () => ({ _id: 'role-1', ...payload }) };
    };

    const result = await roleService.create('tenant-1', {
      name: 'Supervisor',
      description: 'Manages OTs and reports',
      permissions: ['ot:read', 'reports:read'],
      isDefault: false,
    });

    assert.equal(createdPayload.tenantId, 'tenant-1');
    assert.equal(result.name, 'Supervisor');
    assert.deepEqual(result.permissions, ['ot:read', 'reports:read']);
  });

  it('rejects invalid permissions', async () => {
    await assert.rejects(
      () => roleService.create('tenant-1', { name: 'Broken', permissions: ['invalid:permission'] }),
      (error) => error.statusCode === 422 && error.code === 'INVALID_PERMISSION'
    );
  });

  it('lists roles for the tenant only', async () => {
    Role.find = () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [{ _id: 'role-1', tenantId: 'tenant-1', name: 'Admin' }],
          }),
        }),
      }),
    });
    Role.countDocuments = async () => 1;

    const result = await roleService.list('tenant-1', { page: 1, limit: 10 });

    assert.equal(result.pagination.total, 1);
    assert.equal(result.data[0].tenantId, 'tenant-1');
  });
});