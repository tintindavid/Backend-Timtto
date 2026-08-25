/**
 * tests/integration/cronograma.excel.routes.test.js
 *
 * "Integration" tests for `POST /api/v1/cronogramas/excel`
 * (cronograma-excel-por-filtros, tasks.md 6.6). Following the project
 * convention (see tests/integration/equipoItemDuplicate.routes.test.js):
 * no supertest/mongodb-memory-server — drive authorize -> validate(dto) ->
 * controller in sequence with fake req/res objects, mocking the DB
 * boundary (models) and the PDF microservice client.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { downloadCronogramaPDF, downloadCronogramaExcel } from '../../src/controllers/cronograma.controller.js';
import cronogramaPDFService from '../../src/services/cronogramaPDF.service.js';
import { cronogramaExportService } from '../../src/services/cronogramaExport.service.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { User } from '../../src/models/user.model.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { cronogramaPDFDto } from '../../src/dtos/cronograma.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

const TENANT_1 = 'tenant-1';
const TENANT_2 = 'tenant-2';
const CLIENTE_ID = '507f1f77bcf86cd799439001';
const SERVICIO_ID = '507f1f77bcf86cd799439006';
const SEDE_ID = '507f1f77bcf86cd799439005';

function equipoFixtures(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `507f1f77bcf86cd7994391${String(i).padStart(2, '0')}`,
    tenantId: TENANT_1,
    ClienteId: CLIENTE_ID,
    item: `Equipo ${i}`,
    Marca: 'Philips',
    Serie: `S${i}`,
    ItemId: { Nombre: `Equipo ${i}` },
    SedeId: { _id: SEDE_ID, nombreSede: 'Sede Norte' },
    Servicio: { _id: SERVICIO_ID, nombre: 'UCI' },
    mesesMtto: ['ene'],
    mesesMttoRealizados: [],
  }));
}

function stubModels({ equipos, clienteExistsForTenant = TENANT_1 }) {
  EquipoItem.find = () => ({
    populate() { return this; },
    lean: () => Promise.resolve(equipos),
  });
  Customer.findOne = (query) => ({
    lean: () => Promise.resolve(query.tenantId === clienteExistsForTenant ? { _id: CLIENTE_ID, Razonsocial: 'Cliente Demo' } : null),
  });
  Tenant.findOne = () => ({ lean: () => Promise.resolve({ tenantId: TENANT_1, name: 'Timtto', nit: '900123456' }) });
  User.findById = () => ({ lean: () => Promise.resolve({ firstName: 'Ana', lastName: 'Gomez' }) });
}

function baseReq(tenantId, permission) {
  return {
    body: { clienteId: CLIENTE_ID, filtros: {} },
    headers: { 'x-tenant-id': tenantId },
    tenantId,
    userId: 'user-1',
    user: { userId: 'user-1', permissions: [permission] },
  };
}

describe('POST /api/v1/cronogramas/excel — parity with /pdf', () => {
  afterEach(() => {
    delete EquipoItem.find;
    delete Customer.findOne;
    delete Tenant.findOne;
    delete User.findById;
    delete cronogramaPDFService.generatePDF;
  });

  it('the same body sent to /pdf and /excel covers the same equipo count', async () => {
    stubModels({ equipos: equipoFixtures(20) });

    let capturedPdfData = null;
    cronogramaPDFService.generatePDF = async (data) => { capturedPdfData = data; return Buffer.from('pdf'); };

    const pdfReq = baseReq(TENANT_1, PERMISSIONS.CRONOGRAMAS_PDF);
    const pdfRes = buildRes();
    await downloadCronogramaPDF(pdfReq, pdfRes, (err) => { throw err; });
    const pdfEquipoCount = capturedPdfData.grupos.reduce((acc, g) => acc + g.equipos.length, 0);

    const excelResult = await cronogramaExportService.generateExcel({ clienteId: CLIENTE_ID, filtros: {} }, TENANT_1);

    assert.equal(pdfEquipoCount, 20);
    assert.equal(excelResult.equipos.length, 20);
    assert.equal(pdfEquipoCount, excelResult.equipos.length);
  });

  it('missing clienteId is rejected with 400 at the DTO layer for both routes', () => {
    let validationErr;
    const req = { body: { filtros: {} } };
    validate(cronogramaPDFDto, 'body')(req, buildRes(), (err) => { validationErr = err; });
    assert.ok(validationErr instanceof ApiError);
    assert.equal(validationErr.statusCode, 400);
  });

  it('a cross-tenant clienteId yields 404 on the excel route', async () => {
    stubModels({ equipos: equipoFixtures(5), clienteExistsForTenant: TENANT_1 });

    const req = baseReq(TENANT_2, PERMISSIONS.EQUIPO_ITEMS_READ);
    const res = buildRes();
    let captured;
    await downloadCronogramaExcel(req, res, (err) => { captured = err; });

    assert.ok(captured instanceof ApiError);
    assert.equal(captured.statusCode, 404);
    assert.equal(captured.code, 'CUSTOMER_NOT_FOUND');
  });

  it('missing permission returns 403 before the controller runs (excel route)', () => {
    const req = { user: { userId: 'user-1', permissions: [] } };
    let authErr;
    authorize(PERMISSIONS.EQUIPO_ITEMS_READ)(req, buildRes(), (err) => { authErr = err; });

    assert.ok(authErr instanceof ApiError);
    assert.equal(authErr.statusCode, 403);
  });
});
