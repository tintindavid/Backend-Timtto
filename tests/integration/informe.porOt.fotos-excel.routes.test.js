/**
 * tests/integration/informe.porOt.fotos-excel.routes.test.js
 *
 * Same convention as informe.porOt.routes.test.js: drive validate(dto) -> authorize -> controller
 * with fake req/res, mocking only the service singleton.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { informeGenerateController } from '../../src/controllers/informeGenerate.controller.js';
import { informeGenerateByOtService } from '../../src/services/informeGenerateByOt.service.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { informeGenerateByOtDto, informeEvidenciasByOtDto } from '../../src/dtos/informeGenerateByOt.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const CLIENTE_ID = '507f1f77bcf86cd799439001';
const OT_ID = '507f1f77bcf86cd799439010';
const TENANT_1 = 'tenant-1';
const USER = { userId: 'u', role: 'admin', permissions: [PERMISSIONS.INFORMES_GENERATE] };
const NO_PERM = { userId: 'u', role: 'technician', permissions: [] };

function buildRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.statusCode = this.statusCode || 200; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(buf) { this.body = buf; this.statusCode = this.statusCode || 200; return this; },
  };
}

function fakePayload(secciones = []) {
  return {
    meta: { clienteId: CLIENTE_ID, clienteNombre: 'ACME S.A.S', tenantNombre: 'T', fechaGeneracion: new Date().toISOString() },
    kpis: {}, secciones, observacionesReportes: [], observacionGeneral: '',
  };
}

function runValidate(dto, body) {
  let err;
  validate(dto, 'body')({ body, originalUrl: '/x' }, buildRes(), (e) => { err = e; });
  return err;
}

describe('informeGenerateByOtDto - new fields', () => {
  const base = { clienteId: CLIENTE_ID, otIds: [OT_ID] };

  it('accepts fotoIds (<=10) and empty observacionesAdicionalesHtml', () => {
    assert.equal(runValidate(informeGenerateByOtDto, { ...base, fotoIds: ['a'.repeat(24)], observacionesAdicionalesHtml: '' }), undefined);
  });
  it('rejects 11 fotoIds', () => {
    const ids = Array.from({ length: 11 }, (_, i) => String(i).padStart(24, '0'));
    assert.equal(runValidate(informeGenerateByOtDto, { ...base, fotoIds: ids }).statusCode, 400);
  });
  it('rejects non-hex fotoIds', () => {
    assert.equal(runValidate(informeGenerateByOtDto, { ...base, fotoIds: ['zzz'] }).statusCode, 400);
  });
  it('rejects observacionesAdicionalesHtml over 20000 chars', () => {
    assert.equal(runValidate(informeGenerateByOtDto, { ...base, observacionesAdicionalesHtml: 'a'.repeat(20001) }).statusCode, 400);
  });
  it('still validates without the new fields', () => {
    assert.equal(runValidate(informeGenerateByOtDto, base), undefined);
  });
});

describe('POST /api/v1/informes/por-ot/evidencias', () => {
  afterEach(() => { delete informeGenerateByOtService.listEvidenciasByOt; });

  it('validates, applies defaults and returns the paginated result', async () => {
    let received;
    informeGenerateByOtService.listEvidenciasByOt = async (params, tenantId) => {
      received = { params, tenantId };
      return { items: [], total: 0, page: 1, limit: 24, hasMore: false };
    };
    const req = { body: { clienteId: CLIENTE_ID, otIds: [OT_ID] }, tenantId: TENANT_1, user: USER, originalUrl: '/x' };
    const res = buildRes();
    let verr;
    validate(informeEvidenciasByOtDto, 'body')(req, res, (e) => { verr = e; });
    assert.equal(verr, undefined);
    await informeGenerateController.listEvidenciasByOt(req, res, (e) => { throw e; });
    assert.equal(received.tenantId, TENANT_1);
    assert.equal(received.params.page, 1);
    assert.equal(received.params.limit, 24);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.hasMore, false);
  });

  it('limit > 24 -> 400', () => {
    assert.equal(runValidate(informeEvidenciasByOtDto, { clienteId: CLIENTE_ID, otIds: [OT_ID], limit: 25 }).statusCode, 400);
  });

  it('missing permission -> 403', () => {
    let aerr;
    authorize(PERMISSIONS.INFORMES_GENERATE)({ user: NO_PERM }, buildRes(), (e) => { aerr = e; });
    assert.equal(aerr.statusCode, 403);
  });

  it('INVALID_OT_SCOPE from the service reaches next()', async () => {
    informeGenerateByOtService.listEvidenciasByOt = async () => { throw new ApiError(400, 'x', 'INVALID_OT_SCOPE'); };
    let nerr;
    await informeGenerateController.listEvidenciasByOt({ body: {}, tenantId: TENANT_1, user: USER }, buildRes(), (e) => { nerr = e; });
    assert.equal(nerr.code, 'INVALID_OT_SCOPE');
  });
});

describe('POST /api/v1/informes/por-ot/xlsx', () => {
  afterEach(() => { delete informeGenerateByOtService.generateByOt; });

  it('returns an xlsx attachment', async () => {
    informeGenerateByOtService.generateByOt = async () => fakePayload([{ sede: 'A', servicio: 'S', reportes: [{ consecutivo: 'R1' }] }]);
    const res = buildRes();
    await informeGenerateController.downloadXlsxByOt(
      { body: { clienteId: CLIENTE_ID, otIds: [OT_ID] }, tenantId: TENANT_1, user: USER }, res, (e) => { throw e; });
    assert.match(res.headers['Content-Type'], /spreadsheetml/);
    assert.match(res.headers['Content-Disposition'], /^attachment; filename="informe_por_ot_.*\.xlsx"$/);
    assert.ok(Buffer.isBuffer(res.body));
  });

  it('falls back to "cliente" in the filename when the sanitized name is empty', async () => {
    informeGenerateByOtService.generateByOt = async () => ({ ...fakePayload(), meta: { ...fakePayload().meta, clienteNombre: '***' } });
    const res = buildRes();
    await informeGenerateController.downloadXlsxByOt(
      { body: { clienteId: CLIENTE_ID, otIds: [OT_ID] }, tenantId: TENANT_1, user: USER }, res, (e) => { throw e; });
    assert.match(res.headers['Content-Disposition'], /filename="informe_por_ot_cliente_\d{4}-\d{2}-\d{2}\.xlsx"/);
  });

  it('INVALID_OT_SCOPE reaches next()', async () => {
    informeGenerateByOtService.generateByOt = async () => { throw new ApiError(400, 'x', 'INVALID_OT_SCOPE'); };
    let nerr;
    await informeGenerateController.downloadXlsxByOt(
      { body: { clienteId: CLIENTE_ID, otIds: [OT_ID] }, tenantId: TENANT_1, user: USER }, buildRes(), (e) => { nerr = e; });
    assert.equal(nerr.code, 'INVALID_OT_SCOPE');
  });

  it('missing permission -> 403', () => {
    let aerr;
    authorize(PERMISSIONS.INFORMES_GENERATE)({ user: NO_PERM }, buildRes(), (e) => { aerr = e; });
    assert.equal(aerr.statusCode, 403);
  });
});

describe('pass-through of new fields to the service', () => {
  afterEach(() => { delete informeGenerateByOtService.generateByOt; });

  it('/por-ot forwards fotoIds and observacionesAdicionalesHtml', async () => {
    let received;
    informeGenerateByOtService.generateByOt = async (params) => { received = params; return fakePayload(); };
    const req = {
      body: { clienteId: CLIENTE_ID, otIds: [OT_ID], fotoIds: ['a'.repeat(24)], observacionesAdicionalesHtml: '<p>x</p>' },
      tenantId: TENANT_1, user: {},
    };
    await informeGenerateController.generateByOt(req, buildRes(), (e) => { throw e; });
    assert.deepEqual(received.fotoIds, ['a'.repeat(24)]);
    assert.equal(received.observacionesAdicionalesHtml, '<p>x</p>');
  });
});
