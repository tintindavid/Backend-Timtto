/**
 * tests/integration/reporteExterno.routes.test.js
 * reportes-externos-mp-mc, tasks 3.x / 4.2. The real router (authenticate, authorize, multer, validate,
 * controller) behind the real tenant chain and the capabilities guard; the service is stubbed at its boundary
 * (its rules are covered by tests/services/reporteExterno.service.test.js).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { tryAuthenticate } from '../../src/middlewares/tryAuthenticate.middleware.js';
import { enforceTenantTokenMatch } from '../../src/middlewares/enforceTenantTokenMatch.middleware.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';
import { enforceTenantCapabilities } from '../../src/middlewares/enforceTenantCapabilities.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import reporteExternoRouter from '../../src/routes/reporteExterno.routes.js';
import { reporteExternoService } from '../../src/services/reporteExterno.service.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { signToken } from '../../src/utils/jwt.util.js';

const EQ = '507f1f77bcf86cd799439011';
const TENANTS = {
  hosp: { tenantId: 'hosp', status: 'active', capabilities: { executesServices: false, registersExternal: true } },
  other: { tenantId: 'other', status: 'active' },
};
const ROLES = {
  'role-all': [PERMISSIONS.REPORTS_CREATE, PERMISSIONS.REPORTS_DELETE],
  'role-create': [PERMISSIONS.REPORTS_CREATE],
  'role-empty': [],
};

let server; let base; let created; let removed;
const saved = {};

before(async () => {
  Object.assign(saved, { tenantFind: Tenant.findOne, userFind: User.findById, roleFind: Role.findOne, create: reporteExternoService.create, remove: reporteExternoService.remove });
  Tenant.findOne = (f) => ({ lean: () => Promise.resolve(TENANTS[f.tenantId] ?? null) });
  User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });
  Role.findOne = (f) => ({ select: () => ({ lean: () => Promise.resolve({ permissions: ROLES[f._id] ?? [] }) }) });

  const app = express();
  app.use(express.json());
  app.use(tryAuthenticate);
  app.use(enforceTenantTokenMatch);
  app.use(tenantResolver);
  app.use(enforceTenantCapabilities);
  app.use('/api/v1/equipos/:equipoId', reporteExternoRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Tenant.findOne = saved.tenantFind; User.findById = saved.userFind; Role.findOne = saved.roleFind;
  reporteExternoService.create = saved.create; reporteExternoService.remove = saved.remove;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  created = []; removed = [];
  reporteExternoService.create = async (args) => { created.push(args); return { report: { _id: 'rep1', consecutivo: 'R000123' }, warnings: ['MES_FUERA_DE_CRONOGRAMA'] }; };
  reporteExternoService.remove = async (args) => { removed.push(args); return { id: args.id }; };
});

const bearer = (roleId, tenantId = 'hosp') => `Bearer ${signToken({ userId: 'u1', role: 'admin', roleId, tenantId })}`;
const url = `/api/v1/equipos/${EQ}/reportes-externos`;
const form = (fields, file) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
  if (file) fd.append('documento', new Blob([file.content], { type: file.type }), file.name);
  return fd;
};
const valid = () => ({ tipoMtto: 'Preventivo', fecha: '2026-03-12', estadoOperativo: 'Operativo', proveedor: 'Taller Libre' });
const post = async (fields, { auth = bearer('role-all'), headers = {}, file } = {}) => {
  const res = await fetch(`${base}${url}`, { method: 'POST', headers: { ...(auth ? { Authorization: auth } : {}), ...headers }, body: form(fields, file) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

describe('POST /equipos/:equipoId/reportes-externos', () => {
  it('without a token -> 401', async () => {
    const { status } = await post(valid(), { auth: null });
    assert.equal(status, 401);
  });

  it('without reports:create -> 403 and the service is not called', async () => {
    const { status } = await post(valid(), { auth: bearer('role-empty') });
    assert.equal(status, 403);
    assert.equal(created.length, 0);
  });

  it('a client-type tenant (executesServices=false) is accepted and gets the warning back', async () => {
    const { status, body } = await post(valid());
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.consecutivo, 'R000123');
    assert.deepEqual(body.warnings, ['MES_FUERA_DE_CRONOGRAMA']);
  });

  it('the tenant and the capabilities come from the token chain, never from the body', async () => {
    await post(valid());
    assert.equal(created[0].tenantId, 'hosp');
    assert.equal(created[0].equipoId, EQ);
    assert.deepEqual(created[0].capabilities, { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false });
    const { status } = await post({ ...valid(), tenantId: 'other' });
    assert.equal(status, 400);
  });

  it('a header naming another tenant is rejected by the token binding', async () => {
    const { status } = await post(valid(), { headers: { 'x-tenant-id': 'other' } });
    assert.equal(status, 403);
    assert.equal(created.length, 0);
  });

  it('parses the verification rows sent as JSON in the multipart body', async () => {
    await post({ ...valid(), verificationParam: [{ magnitud: 'Presion', unidad: 'mmHg', valorReferencia: 120, valorMedido: '118,5', patron: 'Fluke' }] });
    assert.equal(created[0].dto.verificationParam.length, 1);
    assert.equal(created[0].dto.verificationParam[0].magnitud, 'Presion');
  });

  it('invalid verification JSON -> 400', async () => {
    const fd = form(valid());
    fd.append('verificationParam', '{not json');
    const res = await fetch(`${base}${url}`, { method: 'POST', headers: { Authorization: bearer('role-all') }, body: fd });
    assert.equal(res.status, 400);
    assert.equal(created.length, 0);
  });

  it('passes the attached document to the service', async () => {
    const { status } = await post(valid(), { file: { content: '%PDF-1.4', type: 'application/pdf', name: 'cert.pdf' } });
    assert.equal(status, 201);
    assert.equal(created[0].file.originalname, 'cert.pdf');
    assert.equal(created[0].file.mimetype, 'application/pdf');
  });

  it('validation errors -> 400: consecutive, future date, bad state, no provider', async () => {
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    for (const body of [
      { ...valid(), consecutivo: 'R1' },
      { ...valid(), fecha: future },
      { ...valid(), estadoOperativo: 'Roto' },
      { tipoMtto: 'Preventivo', fecha: '2026-03-12', estadoOperativo: 'Operativo' },
      { ...valid(), tipoMtto: 'Predictivo' },
    ]) {
      const { status } = await post(body);
      assert.equal(status, 400, JSON.stringify(body));
    }
    assert.equal(created.length, 0);
  });
});

describe('DELETE /equipos/:equipoId/reportes-externos/:id', () => {
  const del = (auth = bearer('role-all')) => fetch(`${base}${url}/507f1f77bcf86cd799439099`, { method: 'DELETE', headers: auth ? { Authorization: auth } : {} });

  it('without a token -> 401', async () => {
    assert.equal((await del(null)).status, 401);
  });

  it('with reports:create but without reports:delete -> 403', async () => {
    assert.equal((await del(bearer('role-create'))).status, 403);
    assert.equal(removed.length, 0);
  });

  it('with reports:delete -> 200 and the service gets the tenant, equipment, id and capabilities', async () => {
    const res = await del();
    assert.equal(res.status, 200);
    assert.equal(removed[0].tenantId, 'hosp');
    assert.equal(removed[0].equipoId, EQ);
    assert.equal(removed[0].id, '507f1f77bcf86cd799439099');
    assert.deepEqual(removed[0].capabilities, { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false });
  });
});
