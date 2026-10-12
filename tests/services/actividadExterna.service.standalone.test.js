import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { actividadExternaService } from '../../src/services/actividadExterna.service.js';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { logger } from '../../src/config/logger.config.js';

const oid = () => new mongoose.Types.ObjectId().toString();
const originalWarn = logger.warn;
const originalStartSession = mongoose.startSession;

beforeEach(() => {
  CadenaActividad.create = async (docs) => docs.map((d) => ({ ...d, _id: oid() }));
  CadenaActividad.findOneAndUpdate = async (_q, u) => ({ ...u.$set, _id: 'cad-updated' });
  EquipoActividadExterna.create = async (docs) => docs.map((d) => ({ ...d, _id: oid() }));
});

afterEach(() => {
  ['create', 'findOne', 'findOneAndUpdate'].forEach((m) => { delete CadenaActividad[m]; delete EquipoActividadExterna[m]; });
  logger.warn = originalWarn;
  mongoose.startSession = originalStartSession;
});

describe('actividadExternaService standalone Mongo fallback', () => {
  it('create completa sin transaccion y emite logger.warn', async () => {
    const warns = [];
    logger.warn = (msg) => { warns.push(msg); };
    let ended = 0;
    mongoose.startSession = async () => ({
      withTransaction: async () => {
        throw new Error('Transaction numbers are only allowed on a replica set member or mongos');
      },
      endSession: () => { ended++; },
    });
    const sessions = [];
    CadenaActividad.create = async (docs, opts) => { sessions.push(opts.session); return docs.map((d) => ({ ...d, _id: oid() })); };

    const result = await actividadExternaService.create('t1', 'eq1', 'cli1', {
      tipo: 'calibracion', consecutivoExterno: 'C-1', fecha: new Date('2026-01-15').toISOString(),
      proveedor: 'ACME', estadoFinal: 'aprobada', frecuencia: { meses: 12, esUnica: false },
    }, null, 'u1');

    assert.ok(result.cadena);
    assert.equal(result.actividad.esInicioCadena, true);
    assert.equal(sessions[0], null);
    assert.equal(ended, 1);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /standalone/i);
  });
});
