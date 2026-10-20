import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { actividadExternaService } from '../../src/services/actividadExterna.service.js';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { Customer } from '../../src/models/customer.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';

const oid = () => new mongoose.Types.ObjectId().toString();
const addDate = (base, months) => { const d = new Date(base); d.setMonth(d.getMonth() + months); return d; };

const dtoBase = () => ({
  tipo: 'calibracion',
  consecutivoExterno: 'CAL-001',
  fecha: new Date('2026-01-15').toISOString(),
  proveedor: 'ACME',
  estadoFinal: 'aprobada',
  frecuencia: { meses: 12, esUnica: false },
});

const pdfFile = () => ({ buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]), originalname: 'c.pdf', mimetype: 'application/pdf' });

let sessionMock;
let vigenteFecha;
beforeEach(() => {
  sessionMock = {
    withTransaction: async (fn) => fn(),
    endSession: () => {},
  };
  mongoose.startSession = async () => sessionMock;
  CadenaActividad.create = async (docs) => docs.map((d) => ({ ...d, _id: oid() }));
  CadenaActividad.findOne = async () => null;
  CadenaActividad.findOneAndUpdate = async (_q, u) => ({ ...u.$set, _id: 'cad-updated' });
  EquipoActividadExterna.create = async (docs) => docs.map((d) => ({ ...d, _id: oid() }));
  EquipoActividadExterna.findOneAndUpdate = async () => ({});
  // The current activity of the chain (its date is read to refuse an older successor): no date unless a test sets one
  vigenteFecha = null;
  EquipoActividadExterna.findOne = () => ({ select: () => ({ lean: async () => (vigenteFecha ? { fecha: vigenteFecha } : null) }) });
});

afterEach(() => {
  ['create', 'findOne', 'findOneAndUpdate'].forEach((m) => { delete CadenaActividad[m]; delete EquipoActividadExterna[m]; });
  delete firebaseStorageService.uploadActividadExternaEvidencia;
  delete firebaseStorageService.deleteActividadExternaEvidencia;
});

describe('actividadExternaService.create', () => {
  it('sin cadenaIdSucesion crea cadena nueva + actividad con esInicioCadena=true + fechaProxima = fecha + 12m', async () => {
    const created = [];
    CadenaActividad.create = async (docs) => { const d = docs[0]; d._id = oid(); created.push(d); return [d]; };
    const result = await actividadExternaService.create('t1', 'eq1', 'cli1', dtoBase(), null, 'u1');
    assert.equal(created[0].estado, 'vigente');
    assert.equal(result.actividad.esInicioCadena, true);
    assert.equal(new Date(created[0].fechaProxima).toISOString(), addDate(new Date('2026-01-15'), 12).toISOString());
  });

  it('con esUnica=true crea cadena con fechaProxima=null', async () => {
    const created = [];
    CadenaActividad.create = async (docs) => { const d = docs[0]; d._id = oid(); created.push(d); return [d]; };
    await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), frecuencia: { esUnica: true } }, null, 'u1');
    assert.equal(created[0].fechaProxima, null);
    assert.equal(created[0].esUnica, true);
  });

  it('con cadenaIdSucesion valida cierra actividad vigente anterior', async () => {
    const vigenteAnteriorId = oid();
    CadenaActividad.findOne = async () => ({ _id: 'cad-x', tenantId: 't1', equipoId: 'eq1', tipo: 'calibracion', estado: 'vigente', esUnica: false, actividadVigenteId: vigenteAnteriorId });
    let cerradas = 0;
    EquipoActividadExterna.findOneAndUpdate = async (q, u) => { if (q._id === vigenteAnteriorId && u.$set.cerradaAt) cerradas++; return {}; };
    await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-x' }, null, 'u1');
    assert.equal(cerradas, 1);
  });

  it('con cadenaIdSucesion a cadena esUnica -> 400 CHAIN_UNIQUE_NO_SUCCESSION', async () => {
    CadenaActividad.findOne = async () => ({ _id: 'cad-y', tipo: 'calibracion', estado: 'vigente', esUnica: true });
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-y' }, null, 'u1'),
      (err) => err.statusCode === 400 && err.code === 'CHAIN_UNIQUE_NO_SUCCESSION',
    );
  });

  it('con cadenaIdSucesion a cadena de otro tipo -> 400 TYPE_MISMATCH', async () => {
    CadenaActividad.findOne = async () => ({ _id: 'cad-z', tipo: 'verificacion', estado: 'vigente', esUnica: false });
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-z' }, null, 'u1'),
      (err) => err.statusCode === 400 && err.code === 'TYPE_MISMATCH',
    );
  });

  it('con cadenaIdSucesion ya cerrada -> 409 CHAIN_NOT_VIGENTE', async () => {
    CadenaActividad.findOne = async () => ({ _id: 'cad-c', tipo: 'calibracion', estado: 'cerrada_manualmente', esUnica: false });
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-c' }, null, 'u1'),
      (err) => err.statusCode === 409 && err.code === 'CHAIN_NOT_VIGENTE',
    );
  });

  it('sucesora con esUnica=true -> 400 SUCCESSOR_CANNOT_BE_UNIQUE', async () => {
    CadenaActividad.findOne = async () => ({ _id: 'cad-s', tipo: 'calibracion', estado: 'vigente', esUnica: false });
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), frecuencia: { esUnica: true }, cadenaIdSucesion: 'cad-s' }, null, 'u1'),
      (err) => err.statusCode === 400 && err.code === 'SUCCESSOR_CANNOT_BE_UNIQUE',
    );
  });

  // Review Focus #2
  it('con cadenaIdSucesion de otro tenant -> 404 NOT_FOUND, no modifica nada', async () => {
    let writes = 0;
    CadenaActividad.findOne = async (q) => (q.tenantId === 't1' ? null : { _id: 'cad-foreign' });
    EquipoActividadExterna.findOneAndUpdate = async () => { writes++; return {}; };
    EquipoActividadExterna.create = async () => { writes++; return []; };
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-foreign' }, null, 'u1'),
      (err) => err.statusCode === 404 && err.code === 'NOT_FOUND',
    );
    assert.equal(writes, 0);
  });

  // Review Focus #1
  it('falla el commit -> llama deleteActividadExternaEvidencia con storagePath del upload', async () => {
    const uploaded = { url: 'https://x', storagePath: 'clientes/cli1/equipos/eq1/actividades-externas/abc.pdf', nombreOriginal: 'c.pdf', mimetype: 'application/pdf', tamanoBytes: 100 };
    firebaseStorageService.uploadActividadExternaEvidencia = async () => uploaded;
    let deletedPath = null;
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deletedPath = p; };
    CadenaActividad.create = async () => { throw new Error('duplicate key'); };
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', dtoBase(), pdfFile(), 'u1'),
    );
    assert.equal(deletedPath, uploaded.storagePath);
  });

  it('no sube archivo si la cadena de sucesion es invalida (sin huerfanos)', async () => {
    let uploads = 0;
    firebaseStorageService.uploadActividadExternaEvidencia = async () => { uploads++; return { storagePath: 'p' }; };
    CadenaActividad.findOne = async () => null;
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'nope' }, pdfFile(), 'u1'),
      (err) => err.statusCode === 404,
    );
    assert.equal(uploads, 0);
  });

  it('R-T2-1: la actividad retornada no expone evidencia.storagePath', async () => {
    firebaseStorageService.uploadActividadExternaEvidencia = async () => ({ url: 'u', storagePath: 'secret/path', nombreOriginal: 'c.pdf', mimetype: 'application/pdf', tamanoBytes: 1 });
    const { actividad } = await actividadExternaService.create('t1', 'eq1', 'cli1', dtoBase(), pdfFile(), 'u1');
    assert.equal(actividad.evidencia.storagePath, undefined);
    assert.equal(actividad.evidencia.url, 'u');
  });
  it('Finding A: cadena cambio concurrentemente (update condicional null) -> 409 CHAIN_NOT_VIGENTE + cleanup', async () => {
    const vigId = oid();
    CadenaActividad.findOne = async () => ({ _id: 'cad-x', tipo: 'calibracion', estado: 'vigente', esUnica: false, actividadVigenteId: vigId });
    CadenaActividad.findOneAndUpdate = async () => null;
    let deleted = null;
    firebaseStorageService.uploadActividadExternaEvidencia = async () => ({ url: 'u', storagePath: 'p/1' });
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deleted = p; };
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-x' }, pdfFile(), 'u1'),
      (err) => err.statusCode === 409 && err.code === 'CHAIN_NOT_VIGENTE',
    );
    assert.equal(deleted, 'p/1');
  });

  it('Finding B: cerrar vigente anterior devuelve null -> INCONSISTENT_STATE + cleanup', async () => {
    CadenaActividad.findOne = async () => ({ _id: 'cad-x', tipo: 'calibracion', estado: 'vigente', esUnica: false, actividadVigenteId: oid() });
    EquipoActividadExterna.findOneAndUpdate = async () => null;
    let deleted = null;
    firebaseStorageService.uploadActividadExternaEvidencia = async () => ({ url: 'u', storagePath: 'p/2' });
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deleted = p; };
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), cadenaIdSucesion: 'cad-x' }, pdfFile(), 'u1'),
      (err) => err.statusCode === 500 && err.code === 'INCONSISTENT_STATE',
    );
    assert.equal(deleted, 'p/2');
  });

  it('Finding C: sin frecuencia -> 400 FRECUENCIA_REQUIRED y sin upload', async () => {
    let uploads = 0;
    firebaseStorageService.uploadActividadExternaEvidencia = async () => { uploads++; return { storagePath: 'p' }; };
    const dto = dtoBase();
    delete dto.frecuencia;
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', dto, pdfFile(), 'u1'),
      (err) => err.statusCode === 400 && err.code === 'FRECUENCIA_REQUIRED',
    );
    assert.equal(uploads, 0);
  });
});

describe('actividadExternaService.create - provider link', () => {
  const PROV = '507f1f77bcf86cd799439021';
  afterEach(() => { delete Customer.findOne; });

  const stubProvider = (doc) => {
    Customer.findOne = (q) => ({
      select() { return this; },
      lean: () => Promise.resolve(doc && doc.tenantId === q.tenantId && String(doc._id) === String(q._id) ? doc : null),
    });
  };

  it('stores proveedorId and copies the provider name, ignoring the name sent', async () => {
    stubProvider({ _id: PROV, tenantId: 't1', kind: 'provider', Razonsocial: 'ACME SAS' });
    const created = [];
    EquipoActividadExterna.create = async (docs) => { created.push(docs[0]); return docs.map((d) => ({ ...d, _id: oid() })); };
    await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), proveedor: 'Otro nombre', proveedorId: PROV }, null, 'u1');
    assert.equal(String(created[0].proveedorId), PROV);
    assert.equal(created[0].proveedor, 'ACME SAS');
  });

  it('free text keeps working and leaves proveedorId null', async () => {
    const created = [];
    EquipoActividadExterna.create = async (docs) => { created.push(docs[0]); return docs.map((d) => ({ ...d, _id: oid() })); };
    await actividadExternaService.create('t1', 'eq1', 'cli1', dtoBase(), null, 'u1');
    assert.equal(created[0].proveedor, 'ACME');
    assert.equal(created[0].proveedorId, null);
  });

  it('a client used as provider -> 400 INVALID_PROVIDER and nothing is written or uploaded', async () => {
    stubProvider({ _id: PROV, tenantId: 't1', kind: 'customer', Razonsocial: 'Hospital' });
    let wrote = false; let uploaded = false;
    CadenaActividad.create = async () => { wrote = true; return []; };
    EquipoActividadExterna.create = async () => { wrote = true; return []; };
    firebaseStorageService.uploadActividadExternaEvidencia = async () => { uploaded = true; return {}; };
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), proveedorId: PROV }, pdfFile(), 'u1'),
      (err) => err.statusCode === 400 && err.code === 'INVALID_PROVIDER',
    );
    assert.equal(wrote, false);
    assert.equal(uploaded, false);
  });

  it('a provider of another tenant -> 404 CUSTOMER_NOT_FOUND', async () => {
    stubProvider({ _id: PROV, tenantId: 'other', kind: 'provider', Razonsocial: 'Ajeno' });
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), proveedorId: PROV }, null, 'u1'),
      (err) => err.statusCode === 404 && err.code === 'CUSTOMER_NOT_FOUND',
    );
  });
});

describe('actividadExternaService.create - operative state', () => {
  const stateCalls = [];
  const arrangeEquipo = (equipo) => {
    stateCalls.length = 0;
    EquipoItem.findOne = () => ({ lean: () => Promise.resolve(equipo) });
    equipoItemService._appendEstadoOperativoHistory = async (id, next, opts) => { stateCalls.push({ id, next, opts }); return {}; };
  };
  afterEach(() => { delete EquipoItem.findOne; delete equipoItemService._appendEstadoOperativoHistory; });

  it('the estado operativo of the activity becomes the state of the equipment, stamped with the activity date', async () => {
    arrangeEquipo({ _id: 'eq1', estadoOperativoHistory: [] });
    const created = [];
    EquipoActividadExterna.create = async (docs) => { created.push(docs[0]); return docs.map((d) => ({ ...d, _id: oid() })); };
    await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), estadoOperativo: 'Fuera de Servicio' }, null, 'u1', { userId: 'u1', firstName: 'Ana', lastName: 'Perez' });
    assert.equal(created[0].estadoOperativo, 'Fuera de Servicio');
    assert.equal(stateCalls.length, 1);
    assert.equal(stateCalls[0].next, 'Fuera de Servicio');
    assert.equal(stateCalls[0].opts.source, 'actividad-externa');
    assert.equal(stateCalls[0].opts.at.toISOString(), '2026-01-15T00:00:00.000Z');
    assert.equal(stateCalls[0].opts.tenantId, 't1');
    assert.equal(stateCalls[0].opts.panelUser.userId, 'u1');
  });

  it('without estadoOperativo nothing is changed on the equipment (activities loaded before this field)', async () => {
    arrangeEquipo({ _id: 'eq1', estadoOperativoHistory: [] });
    await actividadExternaService.create('t1', 'eq1', 'cli1', dtoBase(), null, 'u1');
    assert.equal(stateCalls.length, 0);
  });

  it('an activity older than the last real state change keeps the activity but not the state', async () => {
    arrangeEquipo({ _id: 'eq1', estadoOperativoHistory: [{ from: 'Operativo', to: 'En Reparacion', source: 'manual', at: new Date('2026-09-01T00:00:00Z') }] });
    const result = await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), estadoOperativo: 'Operativo' }, null, 'u1');
    assert.ok(result.actividad);
    assert.equal(stateCalls.length, 0);
  });

  it('the initial load of the equipment does not block an older activity', async () => {
    arrangeEquipo({ _id: 'eq1', estadoOperativoHistory: [{ from: null, to: 'Operativo', source: 'bulk-upload', at: new Date() }] });
    await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), estadoOperativo: 'En Mantenimiento' }, null, 'u1');
    assert.equal(stateCalls.length, 1);
  });

  it('a failure applying the state does not lose the registered activity', async () => {
    arrangeEquipo({ _id: 'eq1', estadoOperativoHistory: [] });
    equipoItemService._appendEstadoOperativoHistory = async () => { throw new Error('history down'); };
    const result = await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), estadoOperativo: 'Operativo' }, null, 'u1');
    assert.ok(result.actividad);
    assert.ok(result.cadena);
  });

  it('the state of another tenant\'s equipment is never applied (the lookup is tenant scoped)', async () => {
    stateCalls.length = 0;
    let filter;
    EquipoItem.findOne = (f) => { filter = f; return { lean: () => Promise.resolve(null) }; };
    equipoItemService._appendEstadoOperativoHistory = async (id, next, opts) => { stateCalls.push({ id, next, opts }); return {}; };
    await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), estadoOperativo: 'Operativo' }, null, 'u1');
    assert.equal(filter.tenantId, 't1');
    assert.equal(stateCalls.length, 0);
  });
});

describe('actividadExternaService.create - a successor can not be older than the current activity (adversarial M2)', () => {
  const cadenaVigente = () => ({ _id: 'cad-d', tenantId: 't1', equipoId: 'eq1', tipo: 'calibracion', estado: 'vigente', esUnica: false, actividadVigenteId: 'act-vigente' });

  it('an older date is refused with 400 SUCCESSOR_DATE_BEFORE_CURRENT and nothing is written', async () => {
    CadenaActividad.findOne = async () => cadenaVigente();
    vigenteFecha = new Date('2026-07-31T00:00:00.000Z');
    let escrituras = 0;
    EquipoActividadExterna.create = async () => { escrituras++; return [{ _id: 'x' }]; };
    await assert.rejects(
      () => actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), fecha: '2026-04-30', cadenaIdSucesion: 'cad-d' }, null, 'u1'),
      (err) => err.statusCode === 400 && err.code === 'SUCCESSOR_DATE_BEFORE_CURRENT',
    );
    assert.equal(escrituras, 0);
  });

  it('the same day or a later one is accepted', async () => {
    CadenaActividad.findOne = async () => cadenaVigente();
    vigenteFecha = new Date('2026-07-31T00:00:00.000Z');
    for (const fecha of ['2026-07-31', '2026-08-15']) {
      const r = await actividadExternaService.create('t1', 'eq1', 'cli1', { ...dtoBase(), fecha, cadenaIdSucesion: 'cad-d' }, null, 'u1');
      assert.ok(r.actividad, fecha);
    }
  });

  it('the check does not apply to a new chain (no cadenaIdSucesion)', async () => {
    vigenteFecha = new Date('2030-01-01T00:00:00.000Z');
    const r = await actividadExternaService.create('t1', 'eq1', 'cli1', dtoBase(), null, 'u1');
    assert.equal(r.actividad.esInicioCadena, true);
  });
});
