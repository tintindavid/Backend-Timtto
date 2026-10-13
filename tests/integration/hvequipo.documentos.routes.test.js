/**
 * tests/integration/hvequipo.documentos.routes.test.js
 *
 * Mounts the real hvequipo router (authenticate, authorize, multer, validate,
 * controller, service, firebase service validation) on a tiny express app and
 * drives it with fetch/FormData. Only the DB boundary (HVEquipo.findOne, Role)
 * and the Firebase storage deps are stubbed.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

import { signToken } from '../../src/utils/jwt.util.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import hvEquipoRoutes from '../../src/routes/hvequipo.routes.js';
import { HVEquipo } from '../../src/models/hvequipo.model.js';
import { Role } from '../../src/models/role.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

const HV_ID = new mongoose.Types.ObjectId().toString();
const CLIENTE = new mongoose.Types.ObjectId();
const ROLE_OK = new mongoose.Types.ObjectId().toString();
const ROLE_NO = new mongoose.Types.ObjectId().toString();
const URL_PATH = `/api/v1/hv-equipo/${HV_ID}/documentos`;

let server; let base;
const origFindOne = HVEquipo.findOne;
const origRoleFindOne = Role.findOne;
const origDeps = firebaseStorageService.storageDeps;
const origDelete = firebaseStorageService.deleteByPath;
let uploadCalls = 0;
let deleted = [];

const token = (roleId) => signToken({ role: 'admin', roleId, tenantId: 'tenantA' });
const auth = (roleId = ROLE_OK) => ({ Authorization: `Bearer ${token(roleId)}` });

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(256)]);
const makeHv = (docs = []) => {
  const hv = new HVEquipo({ _id: HV_ID, clienteId: CLIENTE, tenantId: 'tenantA', Documentos: docs });
  hv.save = async function save() { await this.validate(); return this; };
  return hv;
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenantId = 'tenantA'; next(); });
  app.use('/api/v1/hv-equipo', hvEquipoRoutes);
  app.use(errorHandler);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;

  Role.findOne = (q) => ({
    select: () => ({
      lean: async () => ({ permissions: String(q._id) === ROLE_OK ? ['hv-equipos:update'] : ['hv-equipos:read'] }),
    }),
  });
});

after(() => new Promise((r) => {
  Role.findOne = origRoleFindOne;
  server.close(r);
}));

afterEach(() => {
  HVEquipo.findOne = origFindOne;
  firebaseStorageService.storageDeps = origDeps;
  firebaseStorageService.deleteByPath = origDelete;
  uploadCalls = 0;
  deleted = [];
});

function stubStorage() {
  firebaseStorageService.storageDeps = {
    getFirebaseStorage: () => ({}),
    ref: (_s, p) => ({ fullPath: p }),
    uploadBytes: async () => { uploadCalls += 1; return {}; },
    getDownloadURL: async () => 'https://fb.test/file',
    deleteObject: async () => {},
  };
  firebaseStorageService.deleteByPath = async (p) => { deleted.push(p); };
}

const form = (fields, file) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('archivo', new Blob([file.buf], { type: file.type }), file.name);
  return fd;
};

describe('POST /api/v1/hv-equipo/:id/documentos', () => {
  it('401 without token', async () => {
    const res = await fetch(`${base}${URL_PATH}`, { method: 'POST', body: form({ nombre: 'x' }) });
    assert.equal(res.status, 401);
  });

  it('403 without hv-equipos:update', async () => {
    const res = await fetch(`${base}${URL_PATH}`, { method: 'POST', headers: auth(ROLE_NO), body: form({ nombre: 'x', link: 'https://x.test' }) });
    assert.equal(res.status, 403);
  });

  it('201 multipart happy path stores the file under the tenant/hv path', async () => {
    stubStorage();
    HVEquipo.findOne = async () => makeHv();
    const res = await fetch(`${base}${URL_PATH}`, {
      method: 'POST', headers: auth(),
      body: form({ nombre: 'Ficha' }, { buf: PDF, type: 'application/pdf', name: 'f.pdf' }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    const doc = json.data.Documentos[0];
    assert.equal(doc.nombre, 'Ficha');
    assert.match(doc.storagePath, new RegExp(`^hvequipo/documentos/tenantA/${HV_ID}/.+\\.pdf$`));
    assert.equal(doc.archivoUrl, 'https://fb.test/file');
    assert.equal(uploadCalls, 1);
  });

  it('201 link only', async () => {
    stubStorage();
    HVEquipo.findOne = async () => makeHv();
    const res = await fetch(`${base}${URL_PATH}`, { method: 'POST', headers: auth(), body: form({ nombre: 'M', link: 'https://x.test/m.pdf' }) });
    assert.equal(res.status, 201);
    assert.equal(uploadCalls, 0);
  });

  it('400 INVALID_DOCUMENTO when neither link nor file', async () => {
    stubStorage();
    HVEquipo.findOne = async () => makeHv();
    const res = await fetch(`${base}${URL_PATH}`, { method: 'POST', headers: auth(), body: form({ nombre: 'M' }) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error?.code ?? null, 'INVALID_DOCUMENTO');
    assert.equal(uploadCalls, 0);
  });

  it('400 INVALID_FILE_TYPE for a disallowed MIME', async () => {
    stubStorage();
    HVEquipo.findOne = async () => makeHv();
    const res = await fetch(`${base}${URL_PATH}`, {
      method: 'POST', headers: auth(),
      body: form({ nombre: 'M' }, { buf: Buffer.from('MZ'), type: 'application/x-msdownload', name: 'a.exe' }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error?.code ?? null, 'INVALID_FILE_TYPE');
    assert.equal(uploadCalls, 0);
  });

  it('400 FILE_CONTENT_MISMATCH when magic bytes do not match the declared MIME', async () => {
    stubStorage();
    HVEquipo.findOne = async () => makeHv();
    const res = await fetch(`${base}${URL_PATH}`, {
      method: 'POST', headers: auth(),
      body: form({ nombre: 'M' }, { buf: Buffer.from('#!/bin/sh\necho hi\n'), type: 'application/pdf', name: 'a.pdf' }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error?.code ?? null, 'FILE_CONTENT_MISMATCH');
    assert.equal(uploadCalls, 0);
  });

  it('400 FILE_TOO_LARGE for a file above 10 MiB', async () => {
    stubStorage();
    HVEquipo.findOne = async () => makeHv();
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const res = await fetch(`${base}${URL_PATH}`, {
      method: 'POST', headers: auth(),
      body: form({ nombre: 'M' }, { buf: big, type: 'application/pdf', name: 'big.pdf' }),
    });
    assert.ok([400, 413].includes(res.status));
    assert.equal((await res.json()).error?.code ?? null, 'FILE_TOO_LARGE');
    assert.equal(uploadCalls, 0);
  });

  it('404 when the HV belongs to another tenant (filter includes tenantId)', async () => {
    stubStorage();
    let seen;
    HVEquipo.findOne = async (f) => { seen = f; return null; };
    const res = await fetch(`${base}${URL_PATH}`, { method: 'POST', headers: auth(), body: form({ nombre: 'M', link: 'https://x.test' }) });
    assert.equal(res.status, 404);
    assert.equal(seen.tenantId, 'tenantA');
  });
});

describe('DELETE /api/v1/hv-equipo/:id/documentos/:docId', () => {
  it('200 and deletes the Firebase object', async () => {
    stubStorage();
    const hv = makeHv([{ nombre: 'F', archivoUrl: 'https://fb.test/a', storagePath: `hvequipo/documentos/tenantA/${HV_ID}/a.pdf` }]);
    HVEquipo.findOne = async () => hv;
    const docId = hv.Documentos[0]._id.toString();
    const res = await fetch(`${base}${URL_PATH}/${docId}`, { method: 'DELETE', headers: auth() });
    assert.equal(res.status, 200);
    assert.deepEqual(deleted, [`hvequipo/documentos/tenantA/${HV_ID}/a.pdf`]);
  });

  it('200 but keeps a foreign storagePath untouched (tampered data cannot delete other tenants files)', async () => {
    stubStorage();
    const hv = makeHv([{ nombre: 'F', archivoUrl: 'https://fb.test/a', storagePath: 'hvequipo/documentos/otroTenant/otraHv/x.pdf' }]);
    HVEquipo.findOne = async () => hv;
    const docId = hv.Documentos[0]._id.toString();
    const res = await fetch(`${base}${URL_PATH}/${docId}`, { method: 'DELETE', headers: auth() });
    assert.equal(res.status, 200);
    assert.deepEqual(deleted, []);
  });

  it('403 without permission', async () => {
    const res = await fetch(`${base}${URL_PATH}/${new mongoose.Types.ObjectId()}`, { method: 'DELETE', headers: auth(ROLE_NO) });
    assert.equal(res.status, 403);
  });
});

describe('PUT /api/v1/hv-equipo/:id/documentos/:docId', () => {
  it('200 replaces the file and deletes the old one', async () => {
    stubStorage();
    const hv = makeHv([{ nombre: 'F', archivoUrl: 'https://fb.test/a', storagePath: `hvequipo/documentos/tenantA/${HV_ID}/old.pdf` }]);
    HVEquipo.findOne = async () => hv;
    const docId = hv.Documentos[0]._id.toString();
    const res = await fetch(`${base}${URL_PATH}/${docId}`, {
      method: 'PUT', headers: auth(),
      body: form({}, { buf: PDF, type: 'application/pdf', name: 'n.pdf' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(deleted, [`hvequipo/documentos/tenantA/${HV_ID}/old.pdf`]);
    assert.equal(uploadCalls, 1);
  });
});
