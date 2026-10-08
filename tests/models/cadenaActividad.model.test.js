import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';

describe('CadenaActividad model', () => {
  it('valida tenantId, clienteId, equipoId y tipo requeridos', () => {
    const doc = new CadenaActividad({});
    const err = doc.validateSync();
    assert.ok(err.errors.tenantId);
    assert.ok(err.errors.clienteId);
    assert.ok(err.errors.equipoId);
    assert.ok(err.errors.tipo);
  });

  it('rechaza tipo fuera del enum', () => {
    const doc = new CadenaActividad({
      tenantId: 't1', clienteId: new mongoose.Types.ObjectId(),
      equipoId: new mongoose.Types.ObjectId(), tipo: 'invalid', esUnica: true, estado: 'vigente',
    });
    const err = doc.validateSync();
    assert.ok(err.errors.tipo);
  });

  it('requiere tipoCustom cuando tipo = otro', async () => {
    const doc = new CadenaActividad({
      tenantId: 't1', clienteId: new mongoose.Types.ObjectId(),
      equipoId: new mongoose.Types.ObjectId(), tipo: 'otro', esUnica: true, estado: 'vigente',
    });
    // validateSync no ejecuta hooks pre('validate'); se usa validate() async.
    const err = await doc.validate().then(() => null, (e) => e);
    assert.ok(err.errors.tipoCustom);
  });

  it('requiere frecuenciaMeses cuando esUnica = false', async () => {
    const doc = new CadenaActividad({
      tenantId: 't1', clienteId: new mongoose.Types.ObjectId(),
      equipoId: new mongoose.Types.ObjectId(), tipo: 'calibracion', esUnica: false, estado: 'vigente',
    });
    const err = await doc.validate().then(() => null, (e) => e);
    assert.ok(err.errors.frecuenciaMeses);
  });

  it('valida sin error con esUnica = false y frecuenciaMeses = 12', async () => {
    const doc = new CadenaActividad({
      tenantId: 't1', clienteId: new mongoose.Types.ObjectId(),
      equipoId: new mongoose.Types.ObjectId(), tipo: 'calibracion',
      esUnica: false, frecuenciaMeses: 12, estado: 'vigente',
    });
    const err = await doc.validate().then(() => null, (e) => e);
    assert.equal(err, null);
  });

  it('pre(/^find/) respeta includeDeleted y no inyecta isDeleted', async () => {
    const query = CadenaActividad.find({}).setOptions({ includeDeleted: true });
    await new Promise((res, rej) =>
      CadenaActividad.schema.s.hooks.execPre('find', query, (e) => (e ? rej(e) : res())));
    assert.equal('isDeleted' in query.getFilter(), false);
  });

  it('toJSON excluye __v, isDeleted, deletedAt', () => {
    const doc = new CadenaActividad({
      tenantId: 't1', clienteId: new mongoose.Types.ObjectId(),
      equipoId: new mongoose.Types.ObjectId(), tipo: 'calibracion', esUnica: true, estado: 'vigente',
    });
    const json = doc.toJSON();
    assert.equal(json.__v, undefined);
    assert.equal(json.isDeleted, undefined);
    assert.equal(json.deletedAt, undefined);
  });

  // Review Focus #4
  it('pre(/^find/) excluye documentos con isDeleted = true', async () => {
    const query = CadenaActividad.find({});
    // Los hooks de query corren en exec(); se ejecutan los pre('find') sin DB.
    await new Promise((res, rej) =>
      CadenaActividad.schema.s.hooks.execPre('find', query, (e) => (e ? rej(e) : res())));
    const conditions = query.getFilter();
    assert.equal(conditions.isDeleted, false);
  });
});
