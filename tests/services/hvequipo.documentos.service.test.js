import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { HVEquipo } from '../../src/models/hvequipo.model.js';
import { hVEquipoService } from '../../src/services/hvequipo.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

const HV_ID = new mongoose.Types.ObjectId().toString();
const CLIENTE = new mongoose.Types.ObjectId();
const FILE = { buffer: Buffer.from('%PDF-1.4'), originalname: 'ficha.pdf', mimetype: 'application/pdf' };

let deleted;
let uploads;
const origFindOne = HVEquipo.findOne;
const orig = {};

function makeHv(documentos = [], tenantId = 'tenantA') {
  const hv = new HVEquipo({ _id: HV_ID, clienteId: CLIENTE, tenantId, Documentos: documentos });
  // No DB: run validation only; persisting is a no-op
  hv.save = async function save() {
    await this.validate();
    return this;
  };
  return hv;
}

function stubFindOne(hv) {
  HVEquipo.findOne = async (filter) => (filter.tenantId === hv.tenantId && String(filter._id) === String(hv._id) ? hv : null);
}

beforeEach(() => {
  deleted = [];
  uploads = 0;
  orig.upload = firebaseStorageService.uploadHvDocumento;
  orig.del = firebaseStorageService.deleteByPath;
  firebaseStorageService.uploadHvDocumento = async (buf, name, mime, { tenantId, hvId }) => {
    uploads += 1;
    return {
      url: `https://fb.test/${uploads}`,
      storagePath: `hvequipo/documentos/${tenantId}/${hvId}/new${uploads}.pdf`,
      nombreOriginal: name, mimetype: mime, tamanoBytes: buf.length, uploadedAt: new Date(),
    };
  };
  firebaseStorageService.deleteByPath = async (p) => { deleted.push(p); };
});

afterEach(() => {
  HVEquipo.findOne = origFindOne;
  firebaseStorageService.uploadHvDocumento = orig.upload;
  firebaseStorageService.deleteByPath = orig.del;
});

describe('hVEquipoService.addDocumento', () => {
  it('adds a link-only document without uploading', async () => {
    const hv = makeHv();
    stubFindOne(hv);
    const r = await hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'Manual', link: 'https://x.test/m.pdf' });
    assert.equal(r.Documentos.length, 1);
    assert.equal(r.Documentos[0].link, 'https://x.test/m.pdf');
    assert.ok(!r.Documentos[0].archivoUrl);
    assert.equal(uploads, 0);
  });

  it('adds a file-only document with storage metadata', async () => {
    const hv = makeHv();
    stubFindOne(hv);
    const r = await hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'Ficha', file: FILE });
    const d = r.Documentos[0];
    assert.equal(uploads, 1);
    assert.match(d.storagePath, /^hvequipo\/documentos\/tenantA\//);
    assert.equal(d.archivoUrl, 'https://fb.test/1');
    assert.equal(d.mimetype, 'application/pdf');
  });

  it('adds a document with both link and file', async () => {
    const hv = makeHv();
    stubFindOne(hv);
    const r = await hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'Ambos', link: 'https://x.test', file: FILE });
    assert.equal(r.Documentos[0].link, 'https://x.test');
    assert.ok(r.Documentos[0].archivoUrl);
  });

  it('rejects when neither link nor file (400 INVALID_DOCUMENTO)', async () => {
    const hv = makeHv();
    stubFindOne(hv);
    await assert.rejects(
      () => hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'Nada' }),
      (e) => e.statusCode === 400 && e.code === 'INVALID_DOCUMENTO',
    );
    assert.equal(hv.Documentos.length, 0);
    assert.equal(uploads, 0);
  });

  it('404 HV_NOT_FOUND for another tenant (tenant isolation)', async () => {
    const hv = makeHv([], 'tenantB');
    stubFindOne(hv);
    await assert.rejects(
      () => hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'X', link: 'https://x.test' }),
      (e) => e.statusCode === 404 && e.code === 'HV_NOT_FOUND',
    );
  });
});

describe('hVEquipoService.updateDocumento', () => {
  const seed = () => makeHv([{ nombre: 'Doc', archivoUrl: 'https://fb.test/old', storagePath: `hvequipo/documentos/tenantA/${HV_ID}/old.pdf`, mimetype: 'application/pdf' }]);

  it('replacing the file deletes the previous storagePath after saving', async () => {
    const hv = seed();
    stubFindOne(hv);
    const docId = hv.Documentos[0]._id.toString();
    const r = await hVEquipoService.updateDocumento(HV_ID, 'tenantA', docId, { file: FILE });
    assert.equal(r.Documentos[0].archivoUrl, 'https://fb.test/1');
    assert.deepEqual(deleted, [`hvequipo/documentos/tenantA/${HV_ID}/old.pdf`]);
  });

  it('does not delete the old file when the save fails (and cleans up the new one)', async () => {
    const hv = seed();
    stubFindOne(hv);
    hv.save = async () => { throw new Error('db down'); };
    const docId = hv.Documentos[0]._id.toString();
    await assert.rejects(() => hVEquipoService.updateDocumento(HV_ID, 'tenantA', docId, { file: FILE }));
    assert.equal(deleted.includes(`hvequipo/documentos/tenantA/${HV_ID}/old.pdf`), false);
    assert.equal(deleted.length, 1);
  });

  it('404 DOC_NOT_FOUND when docId is missing', async () => {
    const hv = seed();
    stubFindOne(hv);
    await assert.rejects(
      () => hVEquipoService.updateDocumento(HV_ID, 'tenantA', new mongoose.Types.ObjectId().toString(), { nombre: 'x' }),
      (e) => e.statusCode === 404 && e.code === 'DOC_NOT_FOUND',
    );
  });

  it('keeps the invariant: clearing the link of a link-only doc is rejected', async () => {
    const hv = makeHv([{ nombre: 'L', link: 'https://x.test' }]);
    stubFindOne(hv);
    await assert.rejects(
      () => hVEquipoService.updateDocumento(HV_ID, 'tenantA', hv.Documentos[0]._id.toString(), { link: '' }),
      (e) => e.statusCode === 400 && e.code === 'INVALID_DOCUMENTO',
    );
  });
});

describe('hVEquipoService.removeDocumento', () => {
  it('removes a file document and deletes the Firebase object', async () => {
    const hv = makeHv([{ nombre: 'F', archivoUrl: 'https://fb.test/a', storagePath: `hvequipo/documentos/tenantA/${HV_ID}/a.pdf` }]);
    stubFindOne(hv);
    const r = await hVEquipoService.removeDocumento(HV_ID, 'tenantA', hv.Documentos[0]._id.toString());
    assert.equal(r.Documentos.length, 0);
    assert.deepEqual(deleted, [`hvequipo/documentos/tenantA/${HV_ID}/a.pdf`]);
  });

  it('removes a link-only document without calling deleteByPath', async () => {
    const hv = makeHv([{ nombre: 'L', link: 'https://x.test' }]);
    stubFindOne(hv);
    const r = await hVEquipoService.removeDocumento(HV_ID, 'tenantA', hv.Documentos[0]._id.toString());
    assert.equal(r.Documentos.length, 0);
    assert.equal(deleted.length, 0);
  });

  it('404 for a document of another tenant', async () => {
    const hv = makeHv([{ nombre: 'L', link: 'https://x.test' }], 'tenantB');
    stubFindOne(hv);
    await assert.rejects(
      () => hVEquipoService.removeDocumento(HV_ID, 'tenantA', hv.Documentos[0]._id.toString()),
      (e) => e.statusCode === 404,
    );
    assert.equal(deleted.length, 0);
  });
});

describe('HVEquipo model invariant', () => {
  it('pre-validate rejects a Documentos item without link and archivoUrl (INVALID_DOCUMENTO)', async () => {
    const hv = new HVEquipo({ clienteId: CLIENTE, tenantId: 't', Documentos: [{ nombre: 'x' }] });
    await assert.rejects(() => hv.validate(), (e) => e.code === 'INVALID_DOCUMENTO');
  });

  it('OtrasEspecificaciones defaults to [] and requires nombre/valor', async () => {
    const ok = new HVEquipo({ clienteId: CLIENTE, tenantId: 't' });
    assert.deepEqual(ok.OtrasEspecificaciones.toObject(), []);
    const bad = new HVEquipo({ clienteId: CLIENTE, tenantId: 't', OtrasEspecificaciones: [{ nombre: 'RAM' }] });
    await assert.rejects(() => bad.validate());
  });
});

describe('Documentos categoria (guia rapida adjunta)', () => {
  it('defaults to general and stores guia_rapida when requested', async () => {
    const hv = makeHv();
    stubFindOne(hv);
    await hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'Manual', link: 'https://x.test/m' });
    const r = await hVEquipoService.addDocumento(HV_ID, 'tenantA', { nombre: 'Guia', categoria: 'guia_rapida', file: FILE });
    assert.equal(r.Documentos[0].categoria, 'general');
    assert.equal(r.Documentos[1].categoria, 'guia_rapida');
    assert.equal(uploads, 1);
  });

  it('legacy documents without categoria read as general', () => {
    const hv = makeHv([{ nombre: 'Viejo', link: 'https://x.test/v' }]);
    assert.equal(hv.Documentos[0].categoria, 'general');
  });

  it('keeps categoria when the file of a guide is replaced', async () => {
    const hv = makeHv([{ nombre: 'Guia', categoria: 'guia_rapida', archivoUrl: 'https://fb.test/old', storagePath: `hvequipo/documentos/tenantA/${HV_ID}/old.pdf`, mimetype: 'application/pdf' }]);
    stubFindOne(hv);
    const docId = hv.Documentos[0]._id.toString();
    const r = await hVEquipoService.updateDocumento(HV_ID, 'tenantA', docId, { file: FILE });
    assert.equal(r.Documentos[0].categoria, 'guia_rapida');
    assert.deepEqual(deleted, [`hvequipo/documentos/tenantA/${HV_ID}/old.pdf`]);
  });
});

describe('storagePath ownership (cross-tenant delete guard)', () => {
  it('does not delete a foreign storagePath when removing a document', async () => {
    const hv = makeHv([{ nombre: 'Forjado', archivoUrl: 'https://fb.test/x', storagePath: 'hvequipo/documentos/otroTenant/otraHv/secreto.pdf' }]);
    stubFindOne(hv);
    const docId = hv.Documentos[0]._id.toString();
    await hVEquipoService.removeDocumento(HV_ID, 'tenantA', docId);
    assert.deepEqual(deleted, []);
  });

  it('does not delete a foreign storagePath when replacing a file', async () => {
    const hv = makeHv([{ nombre: 'Forjado', archivoUrl: 'https://fb.test/x', storagePath: '../otro/secreto.pdf' }]);
    stubFindOne(hv);
    const docId = hv.Documentos[0]._id.toString();
    await hVEquipoService.updateDocumento(HV_ID, 'tenantA', docId, { file: FILE });
    assert.deepEqual(deleted, []);
  });

  it('still deletes a path under the tenant/HV prefix', async () => {
    const own = `hvequipo/documentos/tenantA/${HV_ID}/mio.pdf`;
    const hv = makeHv([{ nombre: 'Propio', archivoUrl: 'https://fb.test/x', storagePath: own }]);
    stubFindOne(hv);
    await hVEquipoService.removeDocumento(HV_ID, 'tenantA', hv.Documentos[0]._id.toString());
    assert.deepEqual(deleted, [own]);
  });

  it('create/update drop a client-supplied Documentos array', async () => {
    const origUpdate = HVEquipo.findOneAndUpdate;
    let sent;
    HVEquipo.findOneAndUpdate = async (_q, update) => { sent = update; return null; };
    try {
      await hVEquipoService.update(HV_ID, { Documentos: [{ nombre: 'x', storagePath: 'hvequipo/documentos/otro/y.pdf' }], Fabricante: 'F' }, 'tenantA').catch(() => {});
      assert.equal('Documentos' in sent.$set, false);
      assert.equal(sent.$set.Fabricante, 'F');
    } finally {
      HVEquipo.findOneAndUpdate = origUpdate;
    }
  });
});
