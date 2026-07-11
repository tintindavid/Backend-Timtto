import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { reportService } from '../src/services/report.service.js';
import { Report } from '../src/models/report.model.js';
import { firebaseStorageService } from '../src/services/external/firebase.service.js';
import { ApiError } from '../src/utils/apiError.util.js';

function makeFile(overrides = {}) {
  return {
    buffer: Buffer.from('fake-image-bytes'),
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    ...overrides,
  };
}

describe('reportService.addEvidencias', () => {
  let originals;

  beforeEach(() => {
    originals = {
      findOne: Report.findOne,
      findOneAndUpdate: Report.findOneAndUpdate,
      uploadEvidencia: firebaseStorageService.uploadEvidencia.bind(firebaseStorageService),
      deleteByPath: firebaseStorageService.deleteByPath.bind(firebaseStorageService),
    };
  });

  afterEach(() => {
    Report.findOne = originals.findOne;
    Report.findOneAndUpdate = originals.findOneAndUpdate;
    firebaseStorageService.uploadEvidencia = originals.uploadEvidencia;
    firebaseStorageService.deleteByPath = originals.deleteByPath;
  });

  it('uploads one file and persists the subdocument', async () => {
    Report.findOne = async () => ({ _id: 'r1', tenantId: 't1', evidencias: [] });

    let uploadedCalls = 0;
    firebaseStorageService.uploadEvidencia = async (_buf, name) => {
      uploadedCalls += 1;
      return { url: `https://firebase/${name}`, storagePath: `reportes/evidencias/${name}` };
    };

    Report.findOneAndUpdate = async () => ({
      _id: 'r1',
      evidencias: [{ _id: 'e1', url: 'https://firebase/photo.jpg', storagePath: 'reportes/evidencias/photo.jpg', nombre: 'photo.jpg', tipo: 'imagen', mimetype: 'image/jpeg', size: 1024 }],
    });

    const result = await reportService.addEvidencias('r1', 't1', [makeFile()], 'user-1');

    assert.equal(uploadedCalls, 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].nombre, 'photo.jpg');
  });

  it('rejects when adding files would exceed the 3-evidence cap (existing 2 + new 2)', async () => {
    Report.findOne = async () => ({ _id: 'r1', tenantId: 't1', evidencias: [{ _id: 'e1' }, { _id: 'e2' }] });
    let uploads = 0;
    firebaseStorageService.uploadEvidencia = async () => { uploads += 1; return { url: 'u', storagePath: 'p' }; };

    await assert.rejects(
      () => reportService.addEvidencias('r1', 't1', [makeFile(), makeFile()], 'user-1'),
      (err) => err instanceof ApiError && err.code === 'EVIDENCE_LIMIT_EXCEEDED'
    );
    assert.equal(uploads, 0, 'no Firebase upload should happen when over cap');
  });

  it('rejects when report is not found in the tenant (cross-tenant guard)', async () => {
    Report.findOne = async () => null;

    await assert.rejects(
      () => reportService.addEvidencias('r1', 't-other', [makeFile()], 'user-1'),
      (err) => err instanceof ApiError && err.code === 'REPORT_NOT_FOUND'
    );
  });

  it('rejects non-JPEG/PNG mimetype without touching Firebase', async () => {
    let uploads = 0;
    firebaseStorageService.uploadEvidencia = async () => { uploads += 1; return {}; };

    await assert.rejects(
      () => reportService.addEvidencias('r1', 't1', [makeFile({ mimetype: 'application/pdf' })], 'user-1'),
      (err) => err instanceof ApiError && err.code === 'INVALID_FILE_TYPE'
    );
    assert.equal(uploads, 0);
  });

  it('rolls back uploaded blobs when the second upload fails', async () => {
    Report.findOne = async () => ({ _id: 'r1', tenantId: 't1', evidencias: [] });

    const deleted = [];
    firebaseStorageService.deleteByPath = async (storagePath) => {
      deleted.push(storagePath);
    };

    let call = 0;
    firebaseStorageService.uploadEvidencia = async (_buf, name) => {
      call += 1;
      if (call === 2) throw new Error('Firebase outage');
      return { url: `https://firebase/${name}`, storagePath: `reportes/evidencias/${name}` };
    };

    await assert.rejects(
      () => reportService.addEvidencias(
        'r1',
        't1',
        [makeFile({ originalname: 'a.jpg' }), makeFile({ originalname: 'b.jpg' })],
        'user-1'
      ),
      (err) => err instanceof ApiError && err.code === 'UPLOAD_ERROR'
    );

    assert.deepEqual(deleted, ['reportes/evidencias/a.jpg']);
  });
});

describe('reportService.addEvidencias with descripciones', () => {
  let originals;

  beforeEach(() => {
    originals = {
      findOne: Report.findOne,
      findOneAndUpdate: Report.findOneAndUpdate,
      uploadEvidencia: firebaseStorageService.uploadEvidencia.bind(firebaseStorageService),
    };
  });

  afterEach(() => {
    Report.findOne = originals.findOne;
    Report.findOneAndUpdate = originals.findOneAndUpdate;
    firebaseStorageService.uploadEvidencia = originals.uploadEvidencia;
  });

  it('persists trimmed descripcion per-file at the matching index', async () => {
    Report.findOne = async () => ({ _id: 'r1', tenantId: 't1', evidencias: [] });
    firebaseStorageService.uploadEvidencia = async (_b, name) => ({
      url: `https://firebase/${name}`,
      storagePath: `reportes/evidencias/${name}`,
    });

    let pushedDocs = [];
    Report.findOneAndUpdate = async (_filter, update) => {
      pushedDocs = update.$push.evidencias.$each;
      return { evidencias: pushedDocs };
    };

    const result = await reportService.addEvidencias(
      'r1',
      't1',
      [
        { buffer: Buffer.from('a'), originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1 },
        { buffer: Buffer.from('b'), originalname: 'b.jpg', mimetype: 'image/jpeg', size: 1 },
      ],
      'user-1',
      ['  Antes del cambio  ', '']
    );

    assert.equal(result.length, 2);
    assert.equal(result[0].descripcion, 'Antes del cambio');
    assert.equal(result[1].descripcion, '');
  });

  it('rejects descripcion longer than the configured maximum', async () => {
    Report.findOne = async () => ({ _id: 'r1', tenantId: 't1', evidencias: [] });

    const longDesc = 'x'.repeat(121);
    await assert.rejects(
      () =>
        reportService.addEvidencias(
          'r1',
          't1',
          [{ buffer: Buffer.from('a'), originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1 }],
          'user-1',
          [longDesc]
        ),
      (err) => err instanceof ApiError && err.code === 'DESCRIPTION_TOO_LONG'
    );
  });
});

describe('reportService.updateEvidenciaDescripcion', () => {
  let originals;

  beforeEach(() => {
    originals = {
      findOne: Report.findOne,
      findOneAndUpdate: Report.findOneAndUpdate,
    };
  });

  afterEach(() => {
    Report.findOne = originals.findOne;
    Report.findOneAndUpdate = originals.findOneAndUpdate;
  });

  it('updates descripcion (trimmed) on a saved evidence', async () => {
    Report.findOne = async () => ({
      _id: 'r1',
      tenantId: 't1',
      evidencias: { id: (id) => (id === 'e1' ? { _id: 'e1' } : null) },
    });

    let updateArgs;
    Report.findOneAndUpdate = async (filter, update) => {
      updateArgs = { filter, update };
      return { evidencias: [{ _id: 'e1', descripcion: 'Cleaned' }] };
    };

    const result = await reportService.updateEvidenciaDescripcion('r1', 't1', 'e1', '  Cleaned  ');

    assert.equal(updateArgs.update.$set['evidencias.$.descripcion'], 'Cleaned');
    assert.equal(result[0].descripcion, 'Cleaned');
  });

  it('rejects descripcion longer than max length', async () => {
    Report.findOne = async () => ({
      _id: 'r1',
      tenantId: 't1',
      evidencias: { id: () => ({ _id: 'e1' }) },
    });
    await assert.rejects(
      () => reportService.updateEvidenciaDescripcion('r1', 't1', 'e1', 'x'.repeat(121)),
      (err) => err instanceof ApiError && err.code === 'DESCRIPTION_TOO_LONG'
    );
  });

  it('throws REPORT_NOT_FOUND for cross-tenant access', async () => {
    Report.findOne = async () => null;
    await assert.rejects(
      () => reportService.updateEvidenciaDescripcion('r1', 't-other', 'e1', 'x'),
      (err) => err instanceof ApiError && err.code === 'REPORT_NOT_FOUND'
    );
  });

  it('throws EVIDENCE_NOT_FOUND when the subdocument is missing', async () => {
    Report.findOne = async () => ({
      _id: 'r1',
      tenantId: 't1',
      evidencias: { id: () => null },
    });
    await assert.rejects(
      () => reportService.updateEvidenciaDescripcion('r1', 't1', 'missing', 'x'),
      (err) => err instanceof ApiError && err.code === 'EVIDENCE_NOT_FOUND'
    );
  });
});

describe('reportService.removeEvidencia', () => {
  let originals;

  beforeEach(() => {
    originals = {
      findOne: Report.findOne,
      findOneAndUpdate: Report.findOneAndUpdate,
      deleteByPath: firebaseStorageService.deleteByPath.bind(firebaseStorageService),
    };
  });

  afterEach(() => {
    Report.findOne = originals.findOne;
    Report.findOneAndUpdate = originals.findOneAndUpdate;
    firebaseStorageService.deleteByPath = originals.deleteByPath;
  });

  it('removes evidence from DB and from Firebase by storagePath', async () => {
    const evidence = { _id: 'e1', storagePath: 'reportes/evidencias/a.jpg' };
    Report.findOne = async () => ({
      _id: 'r1',
      tenantId: 't1',
      evidencias: { id: (id) => (id === 'e1' ? evidence : null) },
    });
    Report.findOneAndUpdate = async () => ({ evidencias: [] });

    let deleted = null;
    firebaseStorageService.deleteByPath = async (p) => { deleted = p; };

    const result = await reportService.removeEvidencia('r1', 't1', 'e1');

    assert.deepEqual(result, []);
    assert.equal(deleted, 'reportes/evidencias/a.jpg');
  });

  it('throws REPORT_NOT_FOUND when the report is in another tenant', async () => {
    Report.findOne = async () => null;
    await assert.rejects(
      () => reportService.removeEvidencia('r1', 't-other', 'e1'),
      (err) => err instanceof ApiError && err.code === 'REPORT_NOT_FOUND'
    );
  });

  it('throws EVIDENCE_NOT_FOUND when the evidence id does not exist on the report', async () => {
    Report.findOne = async () => ({
      _id: 'r1',
      tenantId: 't1',
      evidencias: { id: () => null },
    });
    await assert.rejects(
      () => reportService.removeEvidencia('r1', 't1', 'e-missing'),
      (err) => err instanceof ApiError && err.code === 'EVIDENCE_NOT_FOUND'
    );
  });
});
