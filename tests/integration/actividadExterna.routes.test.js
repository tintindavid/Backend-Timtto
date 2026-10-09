/**
 * tests/integration/actividadExterna.routes.test.js
 *
 * No supertest/mongodb-memory-server in the repo. We mount the real router on
 * a tiny express app (real authenticate, requireRole, multer, validate,
 * controller) bound to an ephemeral port and drive it with fetch/FormData.
 * Services and EquipoItem are stubbed at the DB boundary. Tokens carry no
 * userId/roleId so authenticate performs no DB lookups.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { signToken } from '../../src/utils/jwt.util.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { actividadExternaRouter } from '../../src/routes/actividadExterna.routes.js';
import { actividadExternaService } from '../../src/services/actividadExterna.service.js';
import { cadenaActividadService } from '../../src/services/cadenaActividad.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';

const EQ = '507f1f77bcf86cd799439011';
const BASE_PATH = `/api/v1/equipos/${EQ}`;
let server; let base;
const adminToken = () => signToken({ userId: undefined, role: 'admin', tenantId: 'tenantA' });
const techToken = () => signToken({ role: 'technician', tenantId: 'tenantA' });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const origFindOne = EquipoItem.findOne;
const saved = {};
const stub = (obj, key, fn) => { saved[key] = saved[key] ?? [obj, obj[key]]; obj[key] = fn; };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/equipos/:equipoId', actividadExternaRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
afterEach(() => {
  for (const k of Object.keys(saved)) { const [o, f] = saved[k]; o[k] = f; delete saved[k]; }
  EquipoItem.findOne = origFindOne;
});

const validFields = () => ({
  tipo: 'calibracion', consecutivoExterno: 'X-1', fecha: '2026-01-15', proveedor: 'ACME', estadoFinal: 'aprobada',
});

describe('routes /equipos/:equipoId/actividades-externas', () => {
  it('GET without auth -> 401', async () => {
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas`);
    assert.equal(res.status, 401);
  });

  it('POST as technician -> 403', async () => {
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas`, {
      method: 'POST', headers: { ...auth(techToken()), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 403);
  });

  it('POST admin with empty body -> 400', async () => {
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas`, {
      method: 'POST', headers: { ...auth(adminToken()), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 400);
  });

  it('POST multipart with frecuencia as JSON string -> 201 (R-PF1), tenant from token', async () => {
    let captured;
    EquipoItem.findOne = () => ({ lean: async () => ({ _id: EQ, ClienteId: 'cli1' }) });
    stub(actividadExternaService, 'create', async (...args) => { captured = args; return { _id: 'a1' }; });
    const fd = new FormData();
    for (const [k, v] of Object.entries(validFields())) fd.append(k, v);
    fd.append('frecuencia', JSON.stringify({ meses: 12, esUnica: false }));
    fd.append('evidencia', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'ev.pdf');
    // body tenantId must be ignored/rejected; tenant comes from token
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas`, {
      method: 'POST', headers: auth(adminToken()), body: fd,
    });
    assert.equal(res.status, 201);
    assert.equal(captured[0], 'tenantA');
    assert.equal(captured[1], EQ);
    assert.equal(captured[2], 'cli1');
    assert.deepEqual(captured[3].frecuencia, { meses: 12, esUnica: false });
    assert.ok(captured[4]?.buffer);
  });

  it('POST with missing/soft-deleted equipo -> 404 and service.create not called', async () => {
    let filter; let createCalled = false;
    EquipoItem.findOne = (f) => { filter = f; return { lean: async () => null }; };
    stub(actividadExternaService, 'create', async () => { createCalled = true; return {}; });
    const fd = new FormData();
    for (const [k, v] of Object.entries(validFields())) fd.append(k, v);
    fd.append('frecuencia', JSON.stringify({ meses: 12, esUnica: false }));
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas`, {
      method: 'POST', headers: auth(adminToken()), body: fd,
    });
    assert.equal(res.status, 404);
    assert.equal(createCalled, false);
    assert.equal(filter.isDeleted, false);
    assert.equal(filter.tenantId, 'tenantA');
  });

  it('POST multipart with invalid frecuencia JSON -> 400', async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(validFields())) fd.append(k, v);
    fd.append('frecuencia', '{not json');
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas`, {
      method: 'POST', headers: auth(adminToken()), body: fd,
    });
    assert.equal(res.status, 400);
  });

  it('GET :id response never contains storagePath (R-T2-1)', async () => {
    stub(actividadExternaService, 'getById', async (t, e, id) => {
      assert.equal(t, 'tenantA');
      return { _id: id, evidencia: { url: 'https://x/y.pdf', nombre: 'y.pdf' } };
    });
    const res = await fetch(`${base}${BASE_PATH}/actividades-externas/abc`, { headers: auth(adminToken()) });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('storagePath'));
    assert.equal(JSON.parse(text).data.evidencia.url, 'https://x/y.pdf');
  });

  it('GET cadenas-actividad?estado=vigente -> 200 with array', async () => {
    stub(cadenaActividadService, 'listVigentesPorTipo', async () => []);
    const res = await fetch(`${base}${BASE_PATH}/cadenas-actividad?estado=vigente`, { headers: auth(techToken()) });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).data));
  });

  it('PATCH cadenas cerrar as technician -> 403', async () => {
    const res = await fetch(`${base}${BASE_PATH}/cadenas-actividad/abc/cerrar`, {
      method: 'PATCH', headers: { ...auth(techToken()), 'Content-Type': 'application/json' }, body: '{"motivoCierre":"x"}',
    });
    assert.equal(res.status, 403);
  });
});
