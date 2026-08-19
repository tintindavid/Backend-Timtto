/**
 * tests/integration/equipoItemDuplicate.routes.test.js
 *
 * "Integration" tests for the duplicate-detection surface of
 * equipo-duplicate-detection-and-replace (tasks.md 6.5/6.6). Following the
 * project convention (see tests/integration/ot.programacion.routes.test.js):
 * no supertest/mongodb-memory-server — drive authorize -> validate(dto) ->
 * controller.<method> in sequence with fake req/res objects, mocking only
 * the service singleton (the DB boundary).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { equipoItemController } from '../../src/controllers/equipoitem.controller.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { createEquipoItemDto } from '../../src/dtos/createEquipoItem.dto.js';
import { duplicateCheckEquipoItemDto } from '../../src/dtos/duplicateCheckEquipoItem.dto.js';
import { duplicateCheckBulkEquipoItemDto } from '../../src/dtos/duplicateCheckBulkEquipoItem.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const CLIENTE_ID = '507f1f77bcf86cd799439001';
const ITEM_ID = '507f1f77bcf86cd799439002';
const SEDE_ID = '507f1f77bcf86cd799439005';
const SERVICIO_ID = '507f1f77bcf86cd799439006';
const EXISTING_ID = '507f1f77bcf86cd799439004';
const TENANT_1 = 'tenant-1';
const TENANT_2 = 'tenant-2';

function existingPayload(overrides = {}) {
  return {
    _id: EXISTING_ID,
    ClienteId: CLIENTE_ID,
    ItemId: { _id: ITEM_ID, Nombre: 'Monitor de signos' },
    SedeId: { _id: SEDE_ID, nombreSede: 'Sede Norte' },
    Servicio: { _id: SERVICIO_ID, nombre: 'UCI' },
    Marca: 'Philips',
    Serie: 'A123',
    ...overrides,
  };
}

describe('POST /api/v1/equipo-items — duplicate conflict', () => {
  afterEach(() => { delete equipoItemService.create; });

  it('a duplicate create returns 409 with populated existing', async () => {
    equipoItemService.create = async () => {
      throw new ApiError(409, 'Equipo duplicado', 'EQUIPO_DUPLICATE', { existing: existingPayload() });
    };

    const req = {
      body: { ClienteId: CLIENTE_ID, Estado: 'Activo', ItemId: ITEM_ID, Marca: 'Philips', SedeId: SEDE_ID, Serie: 'A123', Servicio: SERVICIO_ID },
      tenantId: TENANT_1,
      user: { userId: 'user-1', permissions: [PERMISSIONS.EQUIPO_ITEMS_CREATE] },
    };
    const res = buildRes();

    let authErr;
    authorize(PERMISSIONS.EQUIPO_ITEMS_CREATE)(req, res, (err) => { authErr = err; });
    assert.equal(authErr, undefined);

    let validationErr;
    validate(createEquipoItemDto, 'body')(req, res, (err) => { validationErr = err; });
    assert.equal(validationErr, undefined);

    let capturedErr;
    await equipoItemController.create(req, res, (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'EQUIPO_DUPLICATE');
    assert.equal(capturedErr.details.existing._id, EXISTING_ID);
    assert.equal(capturedErr.details.existing.ItemId.Nombre, 'Monitor de signos');
    assert.equal(capturedErr.details.existing.SedeId.nombreSede, 'Sede Norte');
    assert.equal(capturedErr.details.existing.Servicio.nombre, 'UCI');
  });
});

describe('GET /api/v1/equipo-items/duplicate-check', () => {
  afterEach(() => { delete equipoItemService.checkDuplicate; });

  it('unary pre-check returns { conflict, existing } for a matching tuple', async () => {
    equipoItemService.checkDuplicate = async () => ({ conflict: true, existing: existingPayload() });

    const req = {
      query: { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' },
      tenantId: TENANT_1,
      user: { userId: 'user-1', permissions: [PERMISSIONS.EQUIPO_ITEMS_READ] },
    };
    const res = buildRes();

    let authErr;
    authorize(PERMISSIONS.EQUIPO_ITEMS_READ)(req, res, (err) => { authErr = err; });
    assert.equal(authErr, undefined);

    let validationErr;
    validate(duplicateCheckEquipoItemDto, 'query')(req, res, (err) => { validationErr = err; });
    assert.equal(validationErr, undefined);

    await equipoItemController.duplicateCheck(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.conflict, true);
    assert.equal(res.body.data.existing._id, EXISTING_ID);
  });

  it('unary pre-check returns { conflict: false } when nothing matches', async () => {
    equipoItemService.checkDuplicate = async () => ({ conflict: false });

    const req = {
      query: { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'Z999' },
      tenantId: TENANT_1,
      user: { userId: 'user-1', permissions: [PERMISSIONS.EQUIPO_ITEMS_READ] },
    };
    const res = buildRes();
    validate(duplicateCheckEquipoItemDto, 'query')(req, res, (err) => { if (err) throw err; });
    await equipoItemController.duplicateCheck(req, res, (err) => { throw err; });

    assert.equal(res.body.data.conflict, false);
  });
});

describe('POST /api/v1/equipo-items/duplicate-check/bulk', () => {
  afterEach(() => { delete equipoItemService.checkDuplicateBulk; });

  it('returns a per-row conflict map', async () => {
    equipoItemService.checkDuplicateBulk = async () => ({
      r1: { conflict: true, existing: existingPayload() },
      r2: { conflict: false },
    });

    const req = {
      body: { items: [
        { rowId: 'r1', ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' },
        { rowId: 'r2', ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'Z999' },
      ] },
      tenantId: TENANT_1,
      user: { userId: 'user-1', permissions: [PERMISSIONS.EQUIPO_ITEMS_READ] },
    };
    const res = buildRes();

    let authErr;
    authorize(PERMISSIONS.EQUIPO_ITEMS_READ)(req, res, (err) => { authErr = err; });
    assert.equal(authErr, undefined);

    let validationErr;
    validate(duplicateCheckBulkEquipoItemDto, 'body')(req, res, (err) => { validationErr = err; });
    assert.equal(validationErr, undefined);

    await equipoItemController.duplicateCheckBulk(req, res, (err) => { throw err; });

    assert.equal(res.body.data.results.r1.conflict, true);
    assert.equal(res.body.data.results.r2.conflict, false);
  });

  it('rejects a 501-item payload with 400 at the DTO layer, before the service runs', () => {
    let serviceCalled = false;
    equipoItemService.checkDuplicateBulk = async () => { serviceCalled = true; return {}; };

    const items = Array.from({ length: 501 }, (_, i) => ({
      rowId: `row-${i}`, ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: `S${i}`,
    }));
    const req = { body: { items }, tenantId: TENANT_1, user: { userId: 'user-1' } };

    let validationErr;
    validate(duplicateCheckBulkEquipoItemDto, 'body')(req, buildRes(), (err) => { validationErr = err; });

    assert.ok(validationErr instanceof ApiError);
    assert.equal(validationErr.statusCode, 400);
    assert.equal(serviceCalled, false);
  });
});

describe('Cross-tenant isolation on duplicate detection', () => {
  afterEach(() => { delete equipoItemService.create; delete equipoItemService.checkDuplicate; });

  it('create in tenant 2 with the same tuple as tenant 1 succeeds (no cross-tenant conflict)', async () => {
    let capturedTenant = null;
    equipoItemService.create = async (data, tenantId) => {
      capturedTenant = tenantId;
      return { _id: 'new-equipo-id', ...data, tenantId };
    };

    const req = {
      body: { ClienteId: CLIENTE_ID, Estado: 'Activo', ItemId: ITEM_ID, Marca: 'Philips', SedeId: SEDE_ID, Serie: 'A123', Servicio: SERVICIO_ID },
      tenantId: TENANT_2,
      user: { userId: 'user-2' },
    };
    const res = buildRes();
    await equipoItemController.create(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(capturedTenant, TENANT_2);
  });

  it('unary pre-check in tenant 2 returns conflict:false for a tuple that only exists in tenant 1', async () => {
    // The service itself enforces tenant scoping (see equipoItem.duplicate.test.js);
    // this asserts the controller propagates whatever tenant-scoped result the
    // service returns without leaking cross-tenant data.
    equipoItemService.checkDuplicate = async (fields, tenantId) => {
      assert.equal(tenantId, TENANT_2);
      return { conflict: false };
    };

    const req = {
      query: { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' },
      tenantId: TENANT_2,
      user: { userId: 'user-2' },
    };
    const res = buildRes();
    await equipoItemController.duplicateCheck(req, res, (err) => { throw err; });

    assert.equal(res.body.data.conflict, false);
  });
});
