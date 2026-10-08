import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cadenaActividadService } from '../../src/services/cadenaActividad.service.js';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';

describe('cadenaActividadService.listVigentesPorTipo', () => {
  afterEach(() => { delete CadenaActividad.find; });

  it('filtra por tenantId, equipoId, tipo y estado=vigente', async () => {
    let captured = null;
    CadenaActividad.find = (q) => { captured = q; return { sort: () => ({ lean: () => [] }) }; };
    await cadenaActividadService.listVigentesPorTipo('t1', 'eq1', { tipo: 'calibracion' });
    assert.equal(captured.tenantId, 't1');
    assert.equal(captured.equipoId, 'eq1');
    assert.equal(captured.tipo, 'calibracion');
    assert.equal(captured.estado, 'vigente');
  });

  it('normaliza tipoCustom a lowercase para matching', async () => {
    let captured = null;
    CadenaActividad.find = (q) => { captured = q; return { sort: () => ({ lean: () => [] }) }; };
    await cadenaActividadService.listVigentesPorTipo('t1', 'eq1', { tipo: 'otro', tipoCustom: 'Verificación Externa' });
    assert.ok(captured.$expr);
  });
});

describe('cadenaActividadService.listPorEquipo', () => {
  afterEach(() => { delete CadenaActividad.find; delete CadenaActividad.countDocuments; });

  it('incluye isDeleted:false en countDocuments y devuelve meta', async () => {
    let countFilter = null;
    CadenaActividad.find = () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [{ _id: 'a' }] }) }) }) });
    CadenaActividad.countDocuments = async (f) => { countFilter = f; return 1; };
    const r = await cadenaActividadService.listPorEquipo('t1', 'eq1', { estado: 'vigente', page: 1, limit: 10 });
    assert.equal(countFilter.isDeleted, false);
    assert.equal(countFilter.tenantId, 't1');
    assert.deepEqual(r.meta, { total: 1, page: 1, limit: 10 });
  });
});

describe('cadenaActividadService.getById', () => {
  afterEach(() => { delete CadenaActividad.findOne; });

  it('lanza 404 si no existe', async () => {
    CadenaActividad.findOne = () => ({ lean: async () => null });
    await assert.rejects(() => cadenaActividadService.getById('t1', 'eq1', 'c1'), { statusCode: 404 });
  });
});

describe('cadenaActividadService.cerrarManual', () => {
  afterEach(() => { delete CadenaActividad.findOneAndUpdate; });

  it('setea estado=cerrada_manualmente + cerradaAt + cerradaPorUserId + motivoCierre', async () => {
    let updateDoc = null;
    let opts = null;
    CadenaActividad.findOneAndUpdate = (_q, u, o) => { updateDoc = u.$set; opts = o; return { lean: () => ({ _id: 'c1', estado: 'cerrada_manualmente' }) }; };
    await cadenaActividadService.cerrarManual('t1', 'eq1', 'c1', { motivoCierre: 'equipo dado de baja', cerradaPorUserId: 'u1' });
    assert.equal(updateDoc.estado, 'cerrada_manualmente');
    assert.equal(updateDoc.motivoCierre, 'equipo dado de baja');
    assert.equal(updateDoc.cerradaPorUserId, 'u1');
    assert.ok(updateDoc.cerradaAt instanceof Date);
    assert.equal(opts.runValidators, true);
    assert.equal(opts.context, 'query');
  });

  it('lanza 404 si no hay cadena vigente', async () => {
    CadenaActividad.findOneAndUpdate = () => ({ lean: () => null });
    await assert.rejects(() => cadenaActividadService.cerrarManual('t1', 'eq1', 'c1', { motivoCierre: 'x', cerradaPorUserId: 'u1' }), { statusCode: 404 });
  });
});
