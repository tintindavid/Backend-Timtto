import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const makeBuffer = (prefix, size = 1024) => Buffer.concat([prefix, Buffer.alloc(size - prefix.length)]);

describe('firebaseStorageService.uploadActividadExternaEvidencia', () => {
  let uploadedPath = null;
  let uploadCalls = 0;

  beforeEach(() => {
    uploadedPath = null;
    uploadCalls = 0;
    // ESM namespace bindings are immutable: mock via the service's storageDeps seam.
    firebaseStorageService.storageDeps = {
      getFirebaseStorage: () => ({}),
      ref: (_s, p) => { uploadedPath = p; return { fullPath: p }; },
      uploadBytes: async () => { uploadCalls += 1; return {}; },
      getDownloadURL: async () => 'https://firebase.test/download/url',
      deleteObject: async () => {},
    };
  });

  it('rechaza MIME no permitido (400 INVALID_FILE_TYPE)', async () => {
    await assert.rejects(
      () => firebaseStorageService.uploadActividadExternaEvidencia(Buffer.alloc(100), 'x.exe', 'application/x-msdownload', { clienteId: 'c1', equipoId: 'e1' }),
      (err) => err.statusCode === 400 && err.code === 'INVALID_FILE_TYPE',
    );
    assert.equal(uploadCalls, 0);
  });

  it('rechaza archivo > 10 MB (400 FILE_TOO_LARGE)', async () => {
    const bigPdf = makeBuffer(PDF_MAGIC, 10 * 1024 * 1024 + 1);
    await assert.rejects(
      () => firebaseStorageService.uploadActividadExternaEvidencia(bigPdf, 'x.pdf', 'application/pdf', { clienteId: 'c1', equipoId: 'e1' }),
      (err) => err.statusCode === 400 && err.code === 'FILE_TOO_LARGE',
    );
    assert.equal(uploadCalls, 0);
  });

  // Review Focus #3
  it('rechaza magic-bytes mismatch (400 FILE_CONTENT_MISMATCH) antes de subir', async () => {
    const fakePdf = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(2048)]); // PE/EXE
    await assert.rejects(
      () => firebaseStorageService.uploadActividadExternaEvidencia(fakePdf, 'certificado.pdf', 'application/pdf', { clienteId: 'c1', equipoId: 'e1' }),
      (err) => err.statusCode === 400 && err.code === 'FILE_CONTENT_MISMATCH',
    );
    assert.equal(uploadCalls, 0, 'no debe subir a Firebase');
    assert.equal(uploadedPath, null);
  });

  it('sube con path clientes/{clienteId}/equipos/{equipoId}/actividades-externas/{uuid}.{ext}', async () => {
    const result = await firebaseStorageService.uploadActividadExternaEvidencia(
      makeBuffer(PDF_MAGIC, 2048), 'Certificado.pdf', 'application/pdf', { clienteId: 'cli123', equipoId: 'eq456' },
    );
    assert.match(uploadedPath, /^clientes\/cli123\/equipos\/eq456\/actividades-externas\/[0-9a-f-]{36}\.pdf$/);
    assert.equal(result.storagePath, uploadedPath);
    assert.equal(result.url, 'https://firebase.test/download/url');
    assert.equal(result.nombreOriginal, 'Certificado.pdf');
    assert.equal(result.mimetype, 'application/pdf');
    assert.equal(result.tamanoBytes, 2048);
    assert.equal(uploadCalls, 1);
  });
});

describe('firebaseStorageService.deleteActividadExternaEvidencia', () => {
  it('es idempotente: no lanza si el archivo ya no existe', async () => {
    firebaseStorageService.storageDeps = {
      getFirebaseStorage: () => ({}),
      ref: () => ({}),
      deleteObject: async () => { const e = new Error('not found'); e.code = 'storage/object-not-found'; throw e; },
    };
    await firebaseStorageService.deleteActividadExternaEvidencia('clientes/x/equipos/y/actividades-externas/abc.pdf');
  });
});
