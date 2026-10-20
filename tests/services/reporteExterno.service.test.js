/**
 * tests/services/reporteExterno.service.test.js
 * reportes-externos-mp-mc, tasks 2.x / 4.2. DB-free: models, sequence, storage and history are stubbed;
 * the stubs honour the tenantId so the isolation cases are meaningful.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { reporteExternoService } from '../../src/services/reporteExterno.service.js';
import { Report } from '../../src/models/report.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { historyService } from '../../src/services/history.service.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';

const T = 'tenant-a';
const EQ = '507f1f77bcf86cd799439011';
const CLI = '507f1f77bcf86cd799439001';
const PROV = '507f1f77bcf86cd799439021';
const CAPS = { executesServices: false, registersExternal: true };
const USER = { userId: '507f1f77bcf86cd799439031', firstName: 'Ana', lastName: 'Perez' };
const PDF = { buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]), originalname: 'cert.pdf', mimetype: 'application/pdf' };

const chain = (value) => {
  const q = { populate: () => q, select: () => q, lean: () => Promise.resolve(value) };
  return q;
};

const baseEquipo = (over = {}) => ({
  _id: EQ, tenantId: T, ClienteId: CLI, mesesMtto: ['mar', 'sep'], Marca: 'GE', Modelo: 'B20', Serie: 'S1',
  ItemId: { Nombre: 'Monitor' }, estadoOperativoHistory: [], UltimoMtto: null, ...over,
});

let calls;
let equipoDoc;
let reportDoc;
let providerDoc;
let seq;
let failReportCreate;
let failEquipoUpdate;
let otherExternal;

function arrange({ equipo = baseEquipo(), report = null, provider = null, sequence = 123 } = {}) {
  calls = { reportCreate: [], reportUpdate: [], equipoUpdate: [], equipoFind: [], estado: [], history: [], upload: [], deleteDoc: [], sequence: 0 };
  equipoDoc = equipo;
  reportDoc = report;
  providerDoc = provider;
  seq = sequence;
  failReportCreate = false;
  failEquipoUpdate = false;
  otherExternal = [];

  Report.find = () => chain(otherExternal);
  EquipoItem.findOne = (filter) => {
    calls.equipoFind.push(filter);
    const hit = equipoDoc && filter.tenantId === equipoDoc.tenantId && String(filter._id) === String(equipoDoc._id) ? equipoDoc : null;
    return chain(hit);
  };
  EquipoItem.findOneAndUpdate = async (filter, update) => {
    calls.equipoUpdate.push({ filter, update });
    if (failEquipoUpdate) throw new Error('boom');
    return { ...equipoDoc };
  };
  Customer.findOne = (filter) => chain(
    providerDoc && providerDoc.tenantId === filter.tenantId && String(providerDoc._id) === String(filter._id) ? providerDoc : null,
  );
  Counter.findOneAndUpdate = () => { calls.sequence += 1; return { lean: () => Promise.resolve({ seq }) }; };
  Report.create = async (doc) => {
    calls.reportCreate.push(doc);
    if (failReportCreate) throw new Error('db down');
    return { ...doc, _id: 'rep1' };
  };
  Report.findOne = (filter) => {
    const hit = reportDoc && filter.tenantId === reportDoc.tenantId && String(filter._id) === String(reportDoc._id) && String(filter.Equipo) === String(reportDoc.Equipo) ? reportDoc : null;
    return chain(hit);
  };
  Report.findOneAndUpdate = async (filter, update) => { calls.reportUpdate.push({ filter, update }); return {}; };
  firebaseStorageService.uploadReporteExternoDocumento = async (...args) => {
    calls.upload.push(args);
    return { url: 'https://x/doc', storagePath: 'clientes/c/equipos/e/reportes-externos/doc.pdf', nombreOriginal: 'cert.pdf', mimetype: 'application/pdf', tamanoBytes: 4, uploadedAt: new Date() };
  };
  firebaseStorageService.deleteReporteExternoDocumento = async (path) => { calls.deleteDoc.push(path); };
  equipoItemService._appendEstadoOperativoHistory = async (id, next, opts) => { calls.estado.push({ id, next, opts }); return {}; };
  historyService.record = async (entry) => { calls.history.push(entry); };
}

const dto = (over = {}) => ({
  tipoMtto: 'Preventivo', fecha: '2026-03-12T00:00:00.000Z', estadoOperativo: 'Operativo', proveedor: 'Taller Libre', ...over,
});
const create = (over = {}, extra = {}) => reporteExternoService.create({
  tenantId: T, equipoId: EQ, dto: dto(over), capabilities: CAPS, panelUser: USER, ...extra,
});
const rejects = (promise, status, code) => assert.rejects(promise, (err) => {
  assert.equal(err.statusCode, status);
  if (code) assert.equal(err.code, code);
  return true;
});

const saved = {};
beforeEach(() => {
  saved.equipoFind = EquipoItem.findOne; saved.equipoUpd = EquipoItem.findOneAndUpdate; saved.custFind = Customer.findOne;
  saved.counter = Counter.findOneAndUpdate; saved.rCreate = Report.create; saved.rFind = Report.findOne; saved.rUpd = Report.findOneAndUpdate;
  saved.up = firebaseStorageService.uploadReporteExternoDocumento; saved.del = firebaseStorageService.deleteReporteExternoDocumento;
  saved.estado = equipoItemService._appendEstadoOperativoHistory; saved.hist = historyService.record;
  arrange();
});
afterEach(() => {
  EquipoItem.findOne = saved.equipoFind; EquipoItem.findOneAndUpdate = saved.equipoUpd; Customer.findOne = saved.custFind;
  Counter.findOneAndUpdate = saved.counter; Report.create = saved.rCreate; Report.findOne = saved.rFind; Report.findOneAndUpdate = saved.rUpd;
  firebaseStorageService.uploadReporteExternoDocumento = saved.up; firebaseStorageService.deleteReporteExternoDocumento = saved.del;
  equipoItemService._appendEstadoOperativoHistory = saved.estado; historyService.record = saved.hist;
});

describe('reporteExternoService.create - the report', () => {
  it('creates a closed external report without a work order and with an automatic consecutive', async () => {
    const { report } = await create({ consecutivo: 'HACK-1' });
    const doc = calls.reportCreate[0];
    assert.equal(doc.estado, 'Cerrado');
    assert.equal(doc.origen, 'externo');
    assert.equal(doc.orden, undefined);
    assert.equal(doc.consecutivo, 'R000123');
    assert.equal(report.consecutivo, 'R000123');
    assert.equal(doc.tipoMtto, 'Preventivo');
    assert.equal(doc.estadoOperativo, 'Operativo');
    assert.equal(doc.tenantId, T);
    assert.equal(String(doc.Equipo), EQ);
    assert.equal(String(doc.ClienteId), CLI);
    assert.equal(new Date(doc.fechaProcesado).toISOString(), '2026-03-12T00:00:00.000Z');
    assert.equal(doc.equipoSnapshot.ItemText, 'Monitor');
    assert.equal(calls.sequence, 1);
  });

  it('records who registered it and a history entry', async () => {
    await create();
    assert.equal(String(calls.reportCreate[0].externo.registradoPor), USER.userId);
    assert.equal(calls.reportCreate[0].procesadoPor.snapshotName, 'A. Perez');
    assert.equal(calls.history[0].action, 'create-external');
    assert.equal(calls.history[0].resourceType, 'Report');
    assert.equal(calls.history[0].tenantId, T);
  });

  it('stores the third party document number, link and observation', async () => {
    await create({ consecutivoDocumento: 'CERT-889', enlace: 'https://cert.example/889', observacion: 'Todo ok' });
    const doc = calls.reportCreate[0];
    assert.equal(doc.externo.consecutivoDocumento, 'CERT-889');
    assert.equal(doc.externo.enlace, 'https://cert.example/889');
    assert.equal(doc.observacion, 'Todo ok');
  });
});

describe('reporteExternoService.create - rules', () => {
  it('a tenant without registersExternal gets 403 CAPABILITY_DISABLED and nothing happens', async () => {
    await rejects(create({}, { capabilities: { executesServices: true, registersExternal: false } }), 403, 'CAPABILITY_DISABLED');
    assert.equal(calls.reportCreate.length, 0);
    assert.equal(calls.sequence, 0);
    assert.equal(calls.equipoFind.length, 0);
  });

  it('the equipment must belong to the tenant (404) and its id must be valid', async () => {
    arrange({ equipo: baseEquipo({ tenantId: 'other' }) });
    await rejects(create(), 404);
    arrange();
    await rejects(reporteExternoService.create({ tenantId: T, equipoId: 'nope', dto: dto(), capabilities: CAPS }), 404);
    assert.equal(calls.reportCreate.length, 0);
  });

  it('every lookup is filtered by the tenant', async () => {
    await create();
    assert.equal(calls.equipoFind[0].tenantId, T);
    assert.equal(calls.equipoUpdate[0].filter.tenantId, T);
  });

  it('rejects a future date', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString();
    await rejects(create({ fecha: tomorrow }), 400);
    assert.equal(calls.reportCreate.length, 0);
  });

  it('requires a provider: registered or free text', async () => {
    await rejects(create({ proveedor: '' }), 400);
    await rejects(create({ proveedor: undefined }), 400);
    assert.equal(calls.reportCreate.length, 0);
  });
});

describe('reporteExternoService.create - provider', () => {
  it('a registered provider is linked and its name is copied', async () => {
    arrange({ provider: { _id: PROV, tenantId: T, kind: 'provider', Razonsocial: 'Metrologia Andina SAS' } });
    await create({ proveedorId: PROV, proveedor: 'ignored name' });
    const externo = calls.reportCreate[0].externo;
    assert.equal(String(externo.proveedorId), PROV);
    assert.equal(externo.proveedor, 'Metrologia Andina SAS');
  });

  it('a free-text provider keeps proveedorId null', async () => {
    await create();
    assert.equal(calls.reportCreate[0].externo.proveedorId, null);
    assert.equal(calls.reportCreate[0].externo.proveedor, 'Taller Libre');
  });

  it('a client used as provider is rejected before anything is reserved or uploaded', async () => {
    arrange({ provider: { _id: PROV, tenantId: T, kind: 'customer', Razonsocial: 'Hospital' } });
    await rejects(create({ proveedorId: PROV }, { file: PDF }), 400, 'INVALID_PROVIDER');
    assert.equal(calls.sequence, 0);
    assert.equal(calls.upload.length, 0);
    assert.equal(calls.reportCreate.length, 0);
  });

  it('a provider of another tenant is 404', async () => {
    arrange({ provider: { _id: PROV, tenantId: 'other', kind: 'provider', Razonsocial: 'Ajeno' } });
    await rejects(create({ proveedorId: PROV }), 404, 'CUSTOMER_NOT_FOUND');
  });
});

describe('reporteExternoService.create - preventive effects on the equipment', () => {
  it('marks the month as done, sets the last maintenance and computes the next one', async () => {
    const { warnings } = await create();
    const { update } = calls.equipoUpdate[0];
    assert.equal(update.$push.mesesMttoRealizados.mes, 'mar');
    assert.equal(update.$push.mesesMttoRealizados.consecutivo, 'R000123');
    assert.equal(new Date(update.$push.mesesMttoRealizados.fecha).toISOString(), '2026-03-12T00:00:00.000Z');
    assert.equal(update.$set.UltimoConsecutivoMtto, 'R000123');
    assert.equal(new Date(update.$set.UltimoMtto).toISOString(), '2026-03-12T00:00:00.000Z');
    assert.equal(update.$set.ProximoMtto, 'sep');
    assert.deepEqual(warnings, []);
  });

  it('the next maintenance wraps to the first scheduled month of the cycle', async () => {
    await create({ fecha: '2026-09-10T00:00:00.000Z' });
    assert.equal(calls.equipoUpdate[0].update.$set.ProximoMtto, 'mar');
  });

  it('a month outside the schedule is saved and recorded, with a warning', async () => {
    const { warnings } = await create({ fecha: '2026-05-04T00:00:00.000Z' });
    assert.deepEqual(warnings, ['MES_FUERA_DE_CRONOGRAMA']);
    assert.equal(calls.equipoUpdate[0].update.$push.mesesMttoRealizados.mes, 'may');
    assert.equal(calls.reportCreate.length, 1);
  });

  it('an equipment without scheduled months gets no warning and no next maintenance', async () => {
    arrange({ equipo: baseEquipo({ mesesMtto: [] }) });
    const { warnings } = await create();
    assert.deepEqual(warnings, []);
    assert.equal(calls.equipoUpdate[0].update.$set.ProximoMtto, undefined);
    assert.equal(calls.equipoUpdate[0].update.$set.UltimoMtto instanceof Date, true);
  });

  it('registers the operative state through the history helper with the external source', async () => {
    await create({ estadoOperativo: 'En Mantenimiento' });
    assert.equal(calls.estado.length, 1);
    assert.equal(calls.estado[0].next, 'En Mantenimiento');
    assert.equal(calls.estado[0].opts.source, 'report-external');
    assert.equal(calls.estado[0].opts.reportId, 'rep1');
    assert.equal(calls.estado[0].opts.tenantId, T);
    assert.equal(new Date(calls.estado[0].opts.at).toISOString(), '2026-03-12T00:00:00.000Z');
  });

  it('a second service dated later than the first one still updates the state', async () => {
    // the first service left a history entry dated on the service day (not on the day it was typed in)
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date('2026-03-12T00:00:00Z'), from: 'Operativo', to: 'En Mantenimiento', source: 'report-external' }] }) });
    await create({ fecha: '2026-05-04T00:00:00.000Z', estadoOperativo: 'Operativo' });
    assert.equal(calls.estado.length, 1);
    assert.equal(calls.estado[0].next, 'Operativo');
  });
});

describe('reporteExternoService.create - backdated services', () => {
  it('older than the last maintenance: the month is recorded but the current values do not move back', async () => {
    arrange({ equipo: baseEquipo({ UltimoMtto: new Date('2026-09-15T00:00:00Z') }) });
    await create({ fecha: '2026-03-12T00:00:00.000Z' });
    const { update } = calls.equipoUpdate[0];
    assert.equal(update.$push.mesesMttoRealizados.mes, 'mar');
    assert.equal(update.$set, undefined);
  });

  it('older than the last state change: the current state is not overwritten', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date('2026-09-15T10:00:00Z'), from: 'Operativo', to: 'En Reparacion', source: 'manual' }] }) });
    await create({ fecha: '2026-03-12T00:00:00.000Z' });
    assert.equal(calls.estado.length, 0);
  });

  it('a service dated the same day as the last state change still applies its state', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date('2026-03-12T15:30:00Z'), from: 'Operativo', to: 'En Reparacion', source: 'manual' }] }) });
    await create({ fecha: '2026-03-12T00:00:00.000Z' });
    assert.equal(calls.estado.length, 1);
  });

  it('newer than the last maintenance moves the values forward', async () => {
    arrange({ equipo: baseEquipo({ UltimoMtto: new Date('2026-01-10T00:00:00Z') }) });
    await create({ fecha: '2026-03-12T00:00:00.000Z' });
    assert.equal(new Date(calls.equipoUpdate[0].update.$set.UltimoMtto).toISOString(), '2026-03-12T00:00:00.000Z');
  });
});

describe('reporteExternoService.create - corrective', () => {
  it('registers the state but never touches the preventive schedule', async () => {
    const { warnings } = await create({ tipoMtto: 'Correctivo', estadoOperativo: 'Fuera de Servicio', fecha: '2026-05-04T00:00:00.000Z' });
    assert.equal(calls.equipoUpdate.length, 0);
    assert.equal(calls.estado.length, 1);
    assert.deepEqual(warnings, []);
    assert.equal(calls.reportCreate[0].tipoMtto, 'Correctivo');
    assert.deepEqual(calls.reportCreate[0].verificationParam, []);
  });

  it('rejects verification parameters', async () => {
    await rejects(create({ tipoMtto: 'Correctivo', verificationParam: [{ magnitud: 'Presion', valorMedido: 1 }] }), 400);
    assert.equal(calls.reportCreate.length, 0);
  });
});

describe('reporteExternoService.create - verification parameters', () => {
  it('stores sanitized rows of a preventive service', async () => {
    await create({
      verificationParam: [
        { magnitud: ' Presion ', unidad: 'mmHg', valorReferencia: '120', valorMedido: '118,5', patron: 'Fluke' },
        { magnitud: '', unidad: '', valorReferencia: '', valorMedido: '', patron: '' },
      ],
    });
    assert.deepEqual(calls.reportCreate[0].verificationParam, [
      { magnitud: 'Presion', unidad: 'mmHg', valorReferencia: 120, valorMedido: 118.5, patron: 'Fluke' },
    ]);
  });

  it('a non numeric value is a 400 and nothing is created', async () => {
    await rejects(create({ verificationParam: [{ magnitud: 'Presion', valorMedido: 'abc' }] }), 400);
    assert.equal(calls.reportCreate.length, 0);
    assert.equal(calls.equipoUpdate.length, 0);
  });
});

describe('reporteExternoService.create - attachment and compensation', () => {
  it('uploads the document and stores it under the report', async () => {
    await create({}, { file: PDF });
    assert.equal(calls.upload.length, 1);
    assert.equal(calls.upload[0][3].equipoId, EQ);
    assert.equal(calls.reportCreate[0].externo.documento.nombreOriginal, 'cert.pdf');
  });

  it('deletes the uploaded document when the report cannot be created', async () => {
    failReportCreate = true;
    await rejects(create({}, { file: PDF }), 500, 'CREATE_ERROR');
    assert.equal(calls.deleteDoc.length, 1);
  });

  it('reverts the report and deletes the document when the equipment update fails', async () => {
    failEquipoUpdate = true;
    await rejects(create({}, { file: PDF }), 500, 'CREATE_ERROR');
    assert.equal(calls.reportUpdate.length, 1);
    assert.equal(calls.reportUpdate[0].update.$set.isDeleted, true);
    assert.equal(calls.deleteDoc.length, 1);
  });

  it('no file means no upload and no cleanup', async () => {
    await create();
    assert.equal(calls.upload.length, 0);
    assert.equal(calls.reportCreate[0].externo.documento, undefined);
  });
});

describe('reporteExternoService.remove', () => {
  const ext = (over = {}) => ({
    _id: 'rep1', tenantId: T, Equipo: EQ, origen: 'externo', tipoMtto: 'Preventivo', consecutivo: 'R000123',
    externo: { documento: { storagePath: 'clientes/c/doc.pdf' } }, ...over,
  });
  const remove = (extra = {}) => reporteExternoService.remove({ tenantId: T, equipoId: EQ, id: 'rep1', capabilities: CAPS, panelUser: USER, ...extra });
  const withId = (extra = {}) => remove({ id: '507f1f77bcf86cd799439099', ...extra });
  const arrangeRemove = (report, equipo) => arrange({ report: { ...report, _id: '507f1f77bcf86cd799439099' }, equipo });

  it('soft deletes the report, takes the month out and recomputes the last maintenance from what remains', async () => {
    arrangeRemove(ext(), baseEquipo({
      UltimoConsecutivoMtto: 'R000123',
      mesesMtto: ['mar', 'sep'],
      mesesMttoRealizados: [
        { fecha: new Date('2026-03-12T00:00:00Z'), mes: 'mar', consecutivo: 'R000100' },
        { fecha: new Date('2026-09-10T00:00:00Z'), mes: 'sep', consecutivo: 'R000123' },
      ],
    }));
    await withId();
    assert.equal(calls.reportUpdate[0].update.$set.isDeleted, true);
    const { update } = calls.equipoUpdate[0];
    assert.deepEqual(update.$set.mesesMttoRealizados.map((m) => m.consecutivo), ['R000100']);
    assert.equal(update.$set.UltimoConsecutivoMtto, 'R000100');
    assert.equal(new Date(update.$set.UltimoMtto).toISOString(), '2026-03-12T00:00:00.000Z');
    assert.equal(update.$set.ProximoMtto, 'sep');
    assert.deepEqual(calls.deleteDoc, ['clientes/c/doc.pdf']);
    assert.equal(calls.history[0].action, 'delete-external');
  });

  it('when nothing remains the last maintenance is cleared', async () => {
    arrangeRemove(ext(), baseEquipo({ UltimoConsecutivoMtto: 'R000123', mesesMttoRealizados: [{ fecha: new Date('2026-09-10T00:00:00Z'), mes: 'sep', consecutivo: 'R000123' }] }));
    await withId();
    const { update } = calls.equipoUpdate[0];
    assert.deepEqual(update.$set.mesesMttoRealizados, []);
    assert.deepEqual(update.$unset, { UltimoMtto: 1, UltimoConsecutivoMtto: 1 });
  });

  it('a corrective external report does not touch the equipment schedule', async () => {
    arrangeRemove(ext({ tipoMtto: 'Correctivo' }), baseEquipo());
    await withId();
    assert.equal(calls.equipoUpdate.length, 0);
    assert.equal(calls.reportUpdate.length, 1);
  });

  it('an internal report is rejected and nothing changes', async () => {
    arrangeRemove(ext({ origen: 'interno' }), baseEquipo());
    await rejects(withId(), 400, 'NOT_EXTERNAL_REPORT');
    assert.equal(calls.reportUpdate.length, 0);
    assert.equal(calls.equipoUpdate.length, 0);
  });

  it('a report of another tenant or equipment is 404', async () => {
    arrangeRemove(ext({ tenantId: 'other' }), baseEquipo());
    await rejects(withId(), 404);
    arrangeRemove(ext({ Equipo: '507f1f77bcf86cd799439055' }), baseEquipo());
    await rejects(withId(), 404);
    await rejects(remove({ id: 'nope' }), 404);
  });

  it('needs the capability', async () => {
    arrangeRemove(ext(), baseEquipo());
    await rejects(withId({ capabilities: { executesServices: true, registersExternal: false } }), 403, 'CAPABILITY_DISABLED');
    assert.equal(calls.reportUpdate.length, 0);
  });
});

describe('reporteExternoService.create - the initial load never blocks a service', () => {
  it('an equipment loaded today in bulk still takes the state of an older service (real case)', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date(), from: null, to: 'Operativo', source: 'bulk-upload' }] }) });
    await create({ fecha: '2026-04-14T00:00:00.000Z', estadoOperativo: 'Fuera de Servicio' });
    assert.equal(calls.estado.length, 1);
    assert.equal(calls.estado[0].next, 'Fuera de Servicio');
  });

  it('the seed entry written when the equipment was created by hand (from null) does not block either', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date(), from: null, to: 'Operativo', source: 'manual' }] }) });
    await create({ fecha: '2026-04-14T00:00:00.000Z', estadoOperativo: 'En Reparacion' });
    assert.equal(calls.estado.length, 1);
  });

  it('a migration entry does not block', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date(), from: 'Operativo', to: 'Operativo', source: 'migration' }] }) });
    await create({ fecha: '2026-04-14T00:00:00.000Z' });
    assert.equal(calls.estado.length, 1);
  });

  it('a manual change made after the service date still wins', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [{ at: new Date(), from: 'Operativo', to: 'En Reparacion', source: 'manual' }] }) });
    await create({ fecha: '2026-04-14T00:00:00.000Z', estadoOperativo: 'Operativo' });
    assert.equal(calls.estado.length, 0);
  });

  it('the latest service by date decides: an older one registered afterwards does not overwrite it', async () => {
    arrange({ equipo: baseEquipo({ estadoOperativoHistory: [
      { at: new Date(), from: null, to: 'Operativo', source: 'bulk-upload' },
      { at: new Date('2026-09-08T00:00:00Z'), from: 'Operativo', to: 'Operativo', source: 'report-external' },
    ] }) });
    await create({ fecha: '2026-04-14T00:00:00.000Z', estadoOperativo: 'Fuera de Servicio' });
    assert.equal(calls.estado.length, 0);
    assert.equal(calls.reportCreate.length, 1);
  });
});

describe('reporteExternoService.create - the last service decides even when it kept the same state (adversarial F1)', () => {
  it('asks the history helper to record the entry even if the state does not change', async () => {
    arrange();
    await create({ fecha: '2026-09-08T00:00:00.000Z', estadoOperativo: 'Operativo' });
    assert.equal(calls.estado[0].opts.recordSame, true);
  });
});

describe('reporteExternoService.create - a service of another year (adversarial F3)', () => {
  it('is saved but does not mark a month of the current schedule, and warns', async () => {
    arrange({ equipo: baseEquipo({ UltimoMtto: null }) });
    const { warnings } = await create({ fecha: '2025-03-12T00:00:00.000Z' });
    assert.deepEqual(warnings, ['SERVICIO_DE_OTRO_ANIO']);
    assert.equal(calls.reportCreate.length, 1);
    const { update } = calls.equipoUpdate[0];
    assert.equal(update.$push, undefined);
    assert.equal(update.$set.ProximoMtto, undefined);
    assert.equal(new Date(update.$set.UltimoMtto).toISOString(), '2025-03-12T00:00:00.000Z');
  });

  it('when the equipment already has a more recent maintenance nothing on the equipment moves', async () => {
    arrange({ equipo: baseEquipo({ UltimoMtto: new Date('2026-03-12T00:00:00Z') }) });
    const { warnings } = await create({ fecha: '2025-03-12T00:00:00.000Z' });
    assert.deepEqual(warnings, ['SERVICIO_DE_OTRO_ANIO']);
    assert.equal(calls.equipoUpdate.length, 0);
    assert.equal(calls.reportCreate.length, 1);
  });

  it('a service of the current year keeps marking its month', async () => {
    arrange();
    const { warnings } = await create({ fecha: '2026-03-12T00:00:00.000Z' });
    assert.deepEqual(warnings, []);
    assert.equal(calls.equipoUpdate[0].update.$push.mesesMttoRealizados.mes, 'mar');
  });
});

describe('reporteExternoService.remove - other years and the state history (adversarial F3 / F6)', () => {
  const REP = '507f1f77bcf86cd799439099';
  const ext = (over = {}) => ({
    _id: REP, tenantId: T, Equipo: EQ, origen: 'externo', tipoMtto: 'Preventivo', consecutivo: 'R000123', externo: {}, ...over,
  });
  const removeIt = () => reporteExternoService.remove({ tenantId: T, equipoId: EQ, id: REP, capabilities: CAPS, panelUser: USER });

  it('an external service of another year can be the last maintenance after a delete', async () => {
    arrange({
      report: ext(),
      equipo: baseEquipo({ UltimoConsecutivoMtto: 'R000123', mesesMttoRealizados: [{ fecha: new Date('2026-09-10T00:00:00Z'), mes: 'sep', consecutivo: 'R000123' }] }),
    });
    otherExternal = [{ consecutivo: 'R000050', fechaFinalizdo: new Date('2025-03-12T00:00:00Z') }];
    await removeIt();
    const { update } = calls.equipoUpdate[0];
    assert.equal(update.$set.UltimoConsecutivoMtto, 'R000050');
    assert.equal(update.$unset, undefined);
  });

  it('deleting the service that set the current state takes its entry out and restores the previous state', async () => {
    arrange({
      report: ext(),
      equipo: baseEquipo({ EstadoOperativo: 'Fuera de Servicio', estadoOperativoHistory: [
        { at: new Date('2026-01-01T00:00:00Z'), from: null, to: 'Operativo', source: 'bulk-upload' },
        { at: new Date('2026-04-14T00:00:00Z'), from: 'Operativo', to: 'Fuera de Servicio', source: 'report-external', reportId: REP },
      ] }),
    });
    await removeIt();
    const undo = calls.equipoUpdate.find((c) => c.update.$pull);
    assert.deepEqual(undo.update.$pull.estadoOperativoHistory.source, 'report-external');
    assert.equal(undo.update.$set.EstadoOperativo, 'Operativo');
  });

  it('when its entry was not the last one the current state stays', async () => {
    arrange({
      report: ext(),
      equipo: baseEquipo({ EstadoOperativo: 'En Reparacion', estadoOperativoHistory: [
        { at: new Date('2026-04-14T00:00:00Z'), from: 'Operativo', to: 'Fuera de Servicio', source: 'report-external', reportId: REP },
        { at: new Date('2026-09-08T00:00:00Z'), from: 'Fuera de Servicio', to: 'En Reparacion', source: 'report-external', reportId: 'other' },
      ] }),
    });
    await removeIt();
    const undo = calls.equipoUpdate.find((c) => c.update.$pull);
    assert.ok(undo.update.$pull);
    assert.equal(undo.update.$set, undefined);
  });

  it('a delete without state entries does not touch the history', async () => {
    arrange({ report: ext({ tipoMtto: 'Correctivo' }) });
    await removeIt();
    assert.equal(calls.equipoUpdate.find((c) => c.update.$pull), undefined);
  });
});

describe('reporteExternoService.remove - only recomputes what the deleted report set (adversarial S2)', () => {
  const REP = '507f1f77bcf86cd799439099';
  const ext = (over = {}) => ({
    _id: REP, tenantId: T, Equipo: EQ, origen: 'externo', tipoMtto: 'Preventivo', consecutivo: 'R000050', externo: {}, ...over,
  });
  const removeIt = () => reporteExternoService.remove({ tenantId: T, equipoId: EQ, id: REP, capabilities: CAPS, panelUser: USER });

  it('a legacy last maintenance (no entries, another consecutive) is left alone when an old service is deleted', async () => {
    arrange({
      report: ext(),
      equipo: baseEquipo({ UltimoMtto: new Date('2026-06-01T00:00:00Z'), UltimoConsecutivoMtto: 'R000007', mesesMttoRealizados: [] }),
    });
    await removeIt();
    assert.equal(calls.reportUpdate[0].update.$set.isDeleted, true);
    assert.equal(calls.equipoUpdate.filter((c) => !c.update.$pull).length, 0);
  });

  it('an older service that was recorded in the months only loses its month; the last maintenance stays', async () => {
    arrange({
      report: ext(),
      equipo: baseEquipo({
        UltimoMtto: new Date('2026-09-10T00:00:00Z'), UltimoConsecutivoMtto: 'R000123',
        mesesMttoRealizados: [
          { fecha: new Date('2026-03-12T00:00:00Z'), mes: 'mar', consecutivo: 'R000050' },
          { fecha: new Date('2026-09-10T00:00:00Z'), mes: 'sep', consecutivo: 'R000123' },
        ],
      }),
    });
    await removeIt();
    const { update } = calls.equipoUpdate[0];
    assert.deepEqual(update.$set.mesesMttoRealizados.map((m) => m.consecutivo), ['R000123']);
    assert.equal(update.$set.UltimoMtto, undefined);
    assert.equal(update.$unset, undefined);
  });
});
