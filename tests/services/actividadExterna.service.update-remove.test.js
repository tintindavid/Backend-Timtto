import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { actividadExternaService } from '../../src/services/actividadExterna.service.js';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

let sessionMock;
beforeEach(() => {
  sessionMock = { withTransaction: async (fn) => fn(), endSession: () => {} };
  mongoose.startSession = async () => sessionMock;
});
afterEach(() => {
  ['findOne', 'findOneAndUpdate', 'updateOne'].forEach((m) => { delete CadenaActividad[m]; delete EquipoActividadExterna[m]; });
  delete firebaseStorageService.deleteActividadExternaEvidencia;
  delete firebaseStorageService.uploadActividadExternaEvidencia;
});

const FILE = { buffer: Buffer.from('x'), originalname: 'a.pdf', mimetype: 'application/pdf' };

describe('actividadExternaService.remove', () => {
  it('404 si no existe', async () => {
    EquipoActividadExterna.findOne = async () => null;
    await assert.rejects(
      () => actividadExternaService.remove('t1', 'eq1', 'x'),
      (err) => err.statusCode === 404 && err.code === 'NOT_FOUND',
    );
  });

  it('bloquea remove de actividad no vigente (400 CANNOT_DELETE_HISTORICAL)', async () => {
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1', tenantId: 't1', equipoId: 'eq1', cadenaId: 'cad1', cerradaAt: new Date() });
    await assert.rejects(
      () => actividadExternaService.remove('t1', 'eq1', 'a1'),
      (err) => err.statusCode === 400 && err.code === 'CANNOT_DELETE_HISTORICAL',
    );
  });

  it('remove de vigente unica (esInicioCadena=true) soft-deletea la cadena', async () => {
    EquipoActividadExterna.findOne = async () => ({ _id: 'a2', tenantId: 't1', equipoId: 'eq1', cadenaId: 'cad2', cerradaAt: null, esInicioCadena: true, evidencia: null });
    let cadenaDeleted = false;
    CadenaActividad.updateOne = async (q, u) => { if (q._id === 'cad2' && u.$set.isDeleted === true) cadenaDeleted = true; return {}; };
    EquipoActividadExterna.updateOne = async () => ({});
    const r = await actividadExternaService.remove('t1', 'eq1', 'a2');
    assert.equal(r.ok, true);
    assert.equal(cadenaDeleted, true);
  });

  // Review Focus #5
  it('remove de vigente con predecesora re-abre la predecesora + recalcula fechaProxima', async () => {
    const fechaPred = new Date('2026-01-15');
    EquipoActividadExterna.findOne = async (q) => {
      if (q._id === 'a3') return { _id: 'a3', tenantId: 't1', equipoId: 'eq1', cadenaId: 'cad3', cerradaAt: null, esInicioCadena: false, evidencia: null };
      if (q.cerradaPorActividadId === 'a3') return { _id: 'pred', fecha: fechaPred };
      return null;
    };
    let reopenedCorrectly = false;
    let softDeleted = false;
    EquipoActividadExterna.updateOne = async (q, u) => {
      if (q._id === 'pred' && u.$set.cerradaAt === null && u.$set.cerradaPorActividadId === null) reopenedCorrectly = true;
      if (q._id === 'a3' && u.$set.isDeleted === true) softDeleted = true;
      return {};
    };
    let cadenaUpdate = null;
    CadenaActividad.findOneAndUpdate = async (_q, u) => { cadenaUpdate = u.$set; return {}; };
    CadenaActividad.findOne = async () => ({ _id: 'cad3', frecuenciaMeses: 12, esUnica: false });
    await actividadExternaService.remove('t1', 'eq1', 'a3');
    assert.equal(reopenedCorrectly, true);
    assert.equal(softDeleted, true);
    assert.equal(cadenaUpdate.actividadVigenteId, 'pred');
    const expected = new Date(fechaPred); expected.setMonth(expected.getMonth() + 12);
    assert.equal(cadenaUpdate.fechaProxima.toISOString(), expected.toISOString());
  });

  it('500 INCONSISTENT_STATE si no hay predecesora', async () => {
    EquipoActividadExterna.findOne = async (q) => (q._id === 'a5'
      ? { _id: 'a5', cadenaId: 'c', cerradaAt: null, esInicioCadena: false } : null);
    await assert.rejects(
      () => actividadExternaService.remove('t1', 'eq1', 'a5'),
      (err) => err.statusCode === 500 && err.code === 'INCONSISTENT_STATE',
    );
  });

  it('remove borra blob si evidencia presente', async () => {
    let deleted = null;
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deleted = p; };
    EquipoActividadExterna.findOne = async () => ({ _id: 'a4', tenantId: 't1', equipoId: 'eq1', cadenaId: 'cad4', cerradaAt: null, esInicioCadena: true, evidencia: { storagePath: 'clientes/x/evid.pdf' } });
    EquipoActividadExterna.updateOne = async () => ({});
    CadenaActividad.updateOne = async () => ({});
    await actividadExternaService.remove('t1', 'eq1', 'a4');
    assert.equal(deleted, 'clientes/x/evid.pdf');
  });
});

describe('actividadExternaService.update', () => {
  it('aplica solo campos editables', async () => {
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1', tenantId: 't1', equipoId: 'eq1' });
    let setApplied;
    EquipoActividadExterna.findOneAndUpdate = async (_q, u) => { setApplied = u.$set; return { ...u.$set }; };
    const result = await actividadExternaService.update('t1', 'eq1', 'a1', { observacion: 'nota', fecha: '2020-01-01' });
    assert.equal(result.observacion, 'nota');
    assert.equal(setApplied.fecha, undefined);
  });

  it('estadoFinal=otro sin custom -> 400', async () => {
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1' });
    await assert.rejects(
      () => actividadExternaService.update('t1', 'eq1', 'a1', { estadoFinal: 'otro' }),
      (err) => err.statusCode === 400 && err.code === 'ESTADO_FINAL_CUSTOM_REQUIRED',
    );
  });

  it('estadoFinal != otro limpia estadoFinalCustom previo', async () => {
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1', estadoFinal: 'otro', estadoFinalCustom: 'x' });
    let upd;
    EquipoActividadExterna.findOneAndUpdate = async (_q, u) => { upd = u; return { ...u.$set }; };
    await actividadExternaService.update('t1', 'eq1', 'a1', { estadoFinal: 'operativo' });
    assert.deepEqual(upd.$unset, { estadoFinalCustom: 1 });
  });

  it('con file: sube nueva, borra vieja y no expone storagePath', async () => {
    const deleted = [];
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deleted.push(p); };
    firebaseStorageService.uploadActividadExternaEvidencia = async () => ({ storagePath: 'new/p', url: 'u' });
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1', clienteId: 'c1', equipoId: 'eq1', evidencia: { storagePath: 'old/p' } });
    EquipoActividadExterna.findOneAndUpdate = async (_q, u) => ({ ...u.$set });
    const r = await actividadExternaService.update('t1', 'eq1', 'a1', {}, FILE);
    assert.deepEqual(deleted, ['old/p']);
    assert.equal(r.evidencia.storagePath, undefined);
  });

  it('con file y fallo de update: limpia la nueva', async () => {
    const deleted = [];
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deleted.push(p); };
    firebaseStorageService.uploadActividadExternaEvidencia = async () => ({ storagePath: 'new/p' });
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1', clienteId: 'c1', equipoId: 'eq1' });
    EquipoActividadExterna.findOneAndUpdate = async () => { throw new Error('boom'); };
    await assert.rejects(() => actividadExternaService.update('t1', 'eq1', 'a1', {}, FILE));
    assert.deepEqual(deleted, ['new/p']);
  });
});

describe('actividadExternaService.removeEvidencia', () => {
  it('400 NO_EVIDENCE si no hay evidencia', async () => {
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1' });
    await assert.rejects(
      () => actividadExternaService.removeEvidencia('t1', 'eq1', 'a1'),
      (err) => err.statusCode === 400 && err.code === 'NO_EVIDENCE',
    );
  });

  it('unset evidencia + borra blob', async () => {
    let deleted;
    firebaseStorageService.deleteActividadExternaEvidencia = async (p) => { deleted = p; };
    EquipoActividadExterna.findOne = async () => ({ _id: 'a1', evidencia: { storagePath: 'p/1' } });
    EquipoActividadExterna.findOneAndUpdate = async () => ({ _id: 'a1' });
    await actividadExternaService.removeEvidencia('t1', 'eq1', 'a1');
    assert.equal(deleted, 'p/1');
  });
});
