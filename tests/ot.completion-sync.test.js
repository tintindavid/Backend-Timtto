import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { oTService } from '../src/services/ot.service.js';
import { OT } from '../src/models/ot.model.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { InventarioRepuesto } from '../src/models/inventarioRepuesto.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';

describe('oTService.update completion sync', () => {
  it('updates linked repuestos to Instalado and writes trazabilidad records on OT completion', async () => {
    const originals = {
      startSession: OT.startSession,
      findOne: OT.findOne,
      findOneAndUpdate: OT.findOneAndUpdate,
      repuestosFind: Repuestos.find,
      invFindOneAndUpdate: InventarioRepuesto.findOneAndUpdate,
      trazCreate: RepuestoTrazabilidad.create,
    };

    OT.startSession = async () => ({
      withTransaction: async (fn) => fn(),
      endSession: async () => {},
    });

    OT.findOne = () => ({ session: async () => ({ _id: 'ot1', EstadoOt: 'En Progreso' }) });
    OT.findOneAndUpdate = async () => ({ _id: 'ot1', EstadoOt: 'Completado' });

    let repuestoSaved = 0;
    const repuestos = [
      {
        _id: 'r1',
        InventarioItemId: 'inv1',
        CantidadInstalacion: 2,
        EstadoSolicitud: 'En Proceso',
        save: async () => { repuestoSaved += 1; },
      },
    ];
    Repuestos.find = () => ({ session: async () => repuestos });

    InventarioRepuesto.findOneAndUpdate = async () => ({ _id: 'inv1', stockActual: 10 });

    let trazCount = 0;
    RepuestoTrazabilidad.create = async () => { trazCount += 1; return [{ _id: 't1' }]; };

    const result = await oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a');

    assert.equal(result.EstadoOt, 'Completado');
    assert.equal(repuestoSaved, 1);
    assert.equal(trazCount, 1);

    OT.startSession = originals.startSession;
    OT.findOne = originals.findOne;
    OT.findOneAndUpdate = originals.findOneAndUpdate;
    Repuestos.find = originals.repuestosFind;
    InventarioRepuesto.findOneAndUpdate = originals.invFindOneAndUpdate;
    RepuestoTrazabilidad.create = originals.trazCreate;
  });
});
