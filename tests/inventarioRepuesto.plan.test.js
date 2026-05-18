import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inventarioRepuestoService } from '../src/services/inventarioRepuesto.service.js';
import { Tenant } from '../src/models/tenant.model.js';

describe('inventarioRepuestoService plan guard', () => {
  it('returns 403-like error when tenant plan does not include inventario', async () => {
    const originalFindOne = Tenant.findOne;

    Tenant.findOne = () => ({
      lean: async () => ({ tenantId: 'tenant-a', plan: 'free', isDeleted: false }),
    });

    await assert.rejects(
      () => inventarioRepuestoService.validatePlanAccess('tenant-a'),
      (err) => err?.statusCode === 403 || err?.status === 403
    );

    Tenant.findOne = originalFindOne;
  });
});
