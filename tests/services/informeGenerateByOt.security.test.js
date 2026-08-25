/**
 * tests/services/informeGenerateByOt.security.test.js
 *
 * Cross-tenant / cross-client scope guard + DTO cap tests for
 * informeGenerateByOt.service.js (tasks.md 6.2). DB-free — model statics
 * monkey-patched, same convention as informeGenerateByOt.test.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { informeGenerateByOtService } from '../../src/services/informeGenerateByOt.service.js';
import { informeGenerateByOtDto } from '../../src/dtos/informeGenerateByOt.dto.js';
import { Customer } from '../../src/models/customer.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT_A = 'tenant-a';
const CLIENTE_ID = '507f1f77bcf86cd799439001';
const OTHER_CLIENTE_ID = '507f1f77bcf86cd799439099';
const OT_A = '507f1f77bcf86cd799439010';
const OT_CROSS = '507f1f77bcf86cd799439020';

function chainable(result) {
  const obj = {
    select() { return obj; },
    populate() { return obj; },
    lean: () => Promise.resolve(result),
  };
  return obj;
}

function cleanupMocks() {
  delete Customer.findOne;
  delete OT.find;
  delete Report.find;
  delete EquipoItem.find;
  delete Repuestos.find;
  delete Tenant.findOne;
}

function stubTenant() {
  Tenant.findOne = () => chainable(null);
}

describe('informeGenerateByOtService.generateByOt — cross-scope guard', () => {
  afterEach(cleanupMocks);

  it('a cross-tenant otId (simulated as not found by the tenant-scoped OT.find) throws INVALID_OT_SCOPE', async () => {
    Customer.findOne = () => chainable({ _id: CLIENTE_ID, Razonsocial: 'ACME', Ciudad: 'Bogota' });
    stubTenant();
    // Simulates applyTenantFilter excluding the cross-tenant OT: only 1 of 2 requested ids resolves.
    OT.find = () => chainable([{ _id: OT_A, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }]);
    Report.find = () => chainable([]);
    EquipoItem.find = () => chainable([]);
    Repuestos.find = () => chainable([]);

    await assert.rejects(
      () => informeGenerateByOtService.generateByOt(
        { clienteId: CLIENTE_ID, otIds: [OT_A, OT_CROSS] }, TENANT_A, {}, {},
      ),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'INVALID_OT_SCOPE');
        return true;
      },
    );
  });

  it('a cross-cliente otId in the same tenant (excluded by the ClienteId filter) throws INVALID_OT_SCOPE', async () => {
    Customer.findOne = () => chainable({ _id: CLIENTE_ID, Razonsocial: 'ACME', Ciudad: 'Bogota' });
    stubTenant();
    OT.find = () => chainable([{ _id: OT_A, Consecutivo: 'OT-001', TipoServicio: 'Preventivo', EstadoOt: 'Abierta', FechaCreacion: new Date() }]);
    Report.find = () => chainable([]);
    EquipoItem.find = () => chainable([]);
    Repuestos.find = () => chainable([]);

    await assert.rejects(
      () => informeGenerateByOtService.generateByOt(
        { clienteId: CLIENTE_ID, otIds: [OT_A, OT_CROSS] }, TENANT_A, {}, {},
      ),
      (err) => err instanceof ApiError && err.code === 'INVALID_OT_SCOPE' && err.statusCode === 400,
    );
  });
});

describe('informeGenerateByOtDto — validation caps', () => {
  it('empty otIds array is rejected with a 400 validation shape', () => {
    const { error } = informeGenerateByOtDto.validate({ clienteId: CLIENTE_ID, otIds: [] });
    assert.ok(error, 'expected a Joi validation error');
  });

  it('over-cap otIds (201 items) is rejected', () => {
    const otIds = Array.from({ length: 201 }, (_, i) => '507f1f77bcf86cd79943' + i.toString(16).padStart(4, '0'));
    const { error } = informeGenerateByOtDto.validate({ clienteId: CLIENTE_ID, otIds });
    assert.ok(error, 'expected a Joi validation error');
  });

  it('a valid payload passes', () => {
    const { error } = informeGenerateByOtDto.validate({ clienteId: CLIENTE_ID, otIds: [OT_A] });
    assert.equal(error, undefined);
  });
});
