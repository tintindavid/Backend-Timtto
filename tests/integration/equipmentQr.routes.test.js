/**
 * tests/integration/equipmentQr.routes.test.js
 *
 * Same convention as tests/integration/clientAccessToken.routes.test.js: no
 * supertest/mongodb-memory-server — drive authorize -> validate(dto) ->
 * controller.<method> manually with fake req/res/next, mocking the service
 * singletons at the DB boundary.
 *
 * Covers: permission 403, tenant isolation (404 for out-of-tenant id),
 * idempotent POST (201 then 200), bulk > 500 -> 400, PDF Content-Type.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { equipmentQrController } from '../../src/controllers/equipmentQr.controller.js';
import { equipmentQrService } from '../../src/services/equipmentQr.service.js';
import { equipmentQrPdfService } from '../../src/services/equipmentQrPdf.service.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { createEquipmentQrDto } from '../../src/dtos/equipmentQr.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

describe('equipment-qrs admin routes — authorize middleware', () => {
  it('denies POST / with 403 when caller lacks service-qrs:create', async () => {
    const req = { user: { userId: 'u1', tenantId: 't1', permissions: [] } };
    const res = buildRes();
    let err = null;
    authorize(PERMISSIONS.SERVICE_QRS_CREATE)(req, res, (e) => { err = e; });

    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'FORBIDDEN');
  });

  it('allows through when caller has service-qrs:create', async () => {
    const req = { user: { userId: 'u1', tenantId: 't1', permissions: [PERMISSIONS.SERVICE_QRS_CREATE] } };
    const res = buildRes();
    let nextCalled = false;
    authorize(PERMISSIONS.SERVICE_QRS_CREATE)(req, res, (e) => { if (!e) nextCalled = true; });

    assert.equal(nextCalled, true);
  });
});

describe('POST /api/v1/equipment-qrs — idempotent create (D3)', () => {
  afterEach(() => { delete equipmentQrService.generateForEquipo; });

  it('returns 201 when a new QR is created', async () => {
    equipmentQrService.generateForEquipo = async () => ({ created: true, doc: { _id: 'qr1', equipoId: 'eq1' } });

    const req = { body: { equipoId: '507f1f77bcf86cd799439011' }, tenantId: 't1', user: { userId: 'u1' } };
    const res = buildRes();

    await new Promise((resolve) => validate(createEquipmentQrDto, 'body')(req, res, resolve));
    await equipmentQrController.create(req, res, (e) => { throw e; });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
  });

  it('returns 200 (not 201) when the QR already existed', async () => {
    equipmentQrService.generateForEquipo = async () => ({ created: false, doc: { _id: 'qr1', equipoId: 'eq1' } });

    const req = { body: { equipoId: '507f1f77bcf86cd799439011' }, tenantId: 't1', user: { userId: 'u1' } };
    const res = buildRes();

    await equipmentQrController.create(req, res, (e) => { throw e; });

    assert.equal(res.statusCode, 200);
  });
});

describe('getById — tenant isolation', () => {
  afterEach(() => { delete equipmentQrService.getById; });

  it('propagates 404 to next() when the service rejects an out-of-tenant id', async () => {
    equipmentQrService.getById = async () => {
      throw new ApiError(404, 'QR de equipo no encontrado', 'NOT_FOUND', { id: 'x' });
    };

    const req = { params: { id: 'x' }, tenantId: 'tenant-a' };
    const res = buildRes();
    let forwarded = null;
    await equipmentQrController.getById(req, res, (e) => { forwarded = e; });

    assert.ok(forwarded instanceof ApiError);
    assert.equal(forwarded.statusCode, 404);
  });
});

describe('POST /api/v1/equipment-qrs/bulk-generate — D12 hard cap', () => {
  afterEach(() => { delete equipmentQrService.generateBulk; });

  it('forwards 400 BULK_LIMIT_EXCEEDED to next() when the filter resolves beyond 500', async () => {
    equipmentQrService.generateBulk = async () => {
      throw new ApiError(400, 'El filtro resuelve 600 equipos', 'BULK_LIMIT_EXCEEDED', { count: 600, max: 500 });
    };

    const req = { body: { filter: {} }, tenantId: 't1', user: { userId: 'u1' } };
    const res = buildRes();
    let forwarded = null;
    await equipmentQrController.bulkGenerate(req, res, (e) => { forwarded = e; });

    assert.ok(forwarded instanceof ApiError);
    assert.equal(forwarded.statusCode, 400);
    assert.equal(forwarded.code, 'BULK_LIMIT_EXCEEDED');
  });
});

describe('PDF export — Content-Type', () => {
  afterEach(() => {
    delete equipmentQrPdfService.generateSingle;
    delete equipmentQrPdfService.generateBulk;
  });

  it('exportPdfSingle sets Content-Type: application/pdf', async () => {
    equipmentQrPdfService.generateSingle = async () => Buffer.from('%PDF-1.4 fake');

    const req = { params: { id: 'qr1' }, tenantId: 't1' };
    const res = buildRes();
    await equipmentQrController.exportPdfSingle(req, res, (e) => { throw e; });

    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.ok(Buffer.isBuffer(res.body));
  });

  it('exportPdfBulk sets Content-Type: application/pdf for an ids= request', async () => {
    equipmentQrPdfService.generateBulk = async () => Buffer.from('%PDF-1.4 fake-bulk');

    const req = { query: { ids: 'a,b,c' }, tenantId: 't1' };
    const res = buildRes();
    await equipmentQrController.exportPdfBulk(req, res, (e) => { throw e; });

    assert.equal(res.headers['Content-Type'], 'application/pdf');
  });

  it('exportPdfBulk forwards 400 BULK_PDF_LIMIT_EXCEEDED when ids exceed MAX_BULK_PDF', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id${i}`).join(',');
    const req = { query: { ids }, tenantId: 't1' };
    const res = buildRes();
    let forwarded = null;
    await equipmentQrController.exportPdfBulk(req, res, (e) => { forwarded = e; });

    assert.ok(forwarded instanceof ApiError);
    assert.equal(forwarded.statusCode, 400);
    assert.equal(forwarded.code, 'BULK_PDF_LIMIT_EXCEEDED');
  });
});
