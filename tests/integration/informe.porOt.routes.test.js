/**
 * tests/integration/informe.porOt.routes.test.js
 *
 * "Integration" tests for POST /api/v1/informes/por-ot(/pdf) — following the
 * project convention (see tests/integration/equipoItem.estadoOperativo.routes.test.js):
 * no supertest/mongodb-memory-server — drive validate(dto) -> authorize ->
 * controller.<method> in sequence with fake req/res objects, mocking only
 * the service singleton (the DB boundary) and the PDF microservice client.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { informeGenerateController } from '../../src/controllers/informeGenerate.controller.js';
import { informeGenerateByOtService } from '../../src/services/informeGenerateByOt.service.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { informeGenerateByOtDto } from '../../src/dtos/informeGenerateByOt.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';
import PDFMicroserviceClient from '../../src/services/pdfMicroserviceClient.js';

const CLIENTE_ID = '507f1f77bcf86cd799439001';
const OT_ID = '507f1f77bcf86cd799439010';
const TENANT_1 = 'tenant-1';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.statusCode = this.statusCode || 200; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(buf) { this.body = buf; this.statusCode = this.statusCode || 200; return this; },
  };
}

function fakePayload() {
  return {
    meta: {
      clienteId: CLIENTE_ID, clienteNombre: 'ACME S.A.S', clienteCiudad: 'Bogota', clienteLogo: null,
      tenantNombre: 'Tenant Demo', tenantLogo: null,
      fechaGeneracion: new Date().toISOString(),
      responsableNombre: 'Juan Perez', responsableFirmaUrl: null,
      otsSeleccionadas: [{ otId: 'OT_1', consecutivo: 'OT-001', tipoServicio: 'Preventivo', fechaCreacion: '01/01/2026', estadoOt: 'Abierta' }],
    },
    kpis: {
      cumplimientoPct: 100, totalReportes: 1, cumplidos: 1, pendientes: 0, cancelados: 0,
      correctivos: 0, repuestosInstalados: 0, costoTotal: 0, horasServicio: 0.75,
    },
    secciones: [],
    observacionesReportes: [],
    observacionGeneral: '',
  };
}

describe('POST /api/v1/informes/por-ot', () => {
  afterEach(() => { delete informeGenerateByOtService.generateByOt; });

  it('happy path returns 200 + the aggregated payload', async () => {
    informeGenerateByOtService.generateByOt = async () => fakePayload();

    const req = {
      body: { clienteId: CLIENTE_ID, otIds: [OT_ID] },
      tenantId: TENANT_1,
      user: { userId: 'user-1', role: 'admin', permissions: [PERMISSIONS.INFORMES_GENERATE] },
    };
    const res = buildRes();

    let validationErr;
    validate(informeGenerateByOtDto, 'body')(req, res, (err) => { validationErr = err; });
    assert.equal(validationErr, undefined);

    let authErr;
    authorize(PERMISSIONS.INFORMES_GENERATE)(req, res, (err) => { authErr = err; });
    assert.equal(authErr, undefined);

    await informeGenerateController.generateByOt(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.meta.clienteId, CLIENTE_ID);
  });

  it('invalid otIds (empty array) -> 400 before the service runs', () => {
    let serviceCalled = false;
    informeGenerateByOtService.generateByOt = async () => { serviceCalled = true; return fakePayload(); };

    const req = { body: { clienteId: CLIENTE_ID, otIds: [] }, tenantId: TENANT_1, user: { userId: 'user-1' } };
    const res = buildRes();

    let validationErr;
    validate(informeGenerateByOtDto, 'body')(req, res, (err) => { validationErr = err; });

    assert.ok(validationErr instanceof ApiError);
    assert.equal(validationErr.statusCode, 400);
    assert.equal(validationErr.code, 'VALIDATION_ERROR');
    assert.equal(serviceCalled, false);
  });

  it('missing permission -> 403 before the service runs', () => {
    let serviceCalled = false;
    informeGenerateByOtService.generateByOt = async () => { serviceCalled = true; return fakePayload(); };

    const req = {
      body: { clienteId: CLIENTE_ID, otIds: [OT_ID] },
      tenantId: TENANT_1,
      user: { userId: 'user-1', role: 'technician', permissions: [] },
    };
    const res = buildRes();

    let authErr;
    authorize(PERMISSIONS.INFORMES_GENERATE)(req, res, (err) => { authErr = err; });

    assert.ok(authErr instanceof ApiError);
    assert.equal(authErr.statusCode, 403);
    assert.equal(serviceCalled, false);
  });
});

describe('POST /api/v1/informes/por-ot/pdf', () => {
  const originalGeneratePDF = PDFMicroserviceClient.prototype.generatePDF;

  afterEach(() => {
    delete informeGenerateByOtService.generateByOt;
    PDFMicroserviceClient.prototype.generatePDF = originalGeneratePDF;
  });

  it('returns a binary PDF with the expected Content-Type and Content-Disposition', async () => {
    informeGenerateByOtService.generateByOt = async () => fakePayload();
    PDFMicroserviceClient.prototype.generatePDF = async () => Buffer.from('%PDF-1.4 fake');

    const req = {
      body: { clienteId: CLIENTE_ID, otIds: [OT_ID] },
      tenantId: TENANT_1,
      user: { userId: 'user-1', role: 'admin', permissions: [PERMISSIONS.INFORMES_GENERATE] },
    };
    const res = buildRes();

    await informeGenerateController.downloadPdfByOt(req, res, (err) => { throw err; });

    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.match(res.headers['Content-Disposition'], /^attachment; filename="informe_por_ot_.*\.pdf"$/);
    assert.ok(Buffer.isBuffer(res.body));
  });
});
