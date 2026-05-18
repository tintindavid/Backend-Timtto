import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repuestosService } from '../src/services/repuestos.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { OT } from '../src/models/ot.model.js';
import { Report } from '../src/models/report.model.js';
import { EquipoItem } from '../src/models/equipoitem.model.js';
import { Counter } from '../src/models/counter.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';

function makePopulateLean(data) {
  return {
    populate() { return this; },
    lean: async () => data,
  };
}

describe('repuestosService.createOtFromSolicitudes', () => {
  it('creates one report when all selected repuestos share the same equipment', async () => {
    const originals = {
      repuestosFind: Repuestos.find,
      repuestosUpdateMany: Repuestos.updateMany,
      otCreate: OT.create,
      reportCreate: Report.create,
      reportFind: Report.find,
      equipoFindById: EquipoItem.findById,
      counterFindOneAndUpdate: Counter.findOneAndUpdate,
      trazCreate: RepuestoTrazabilidad.create,
    };

    const repuestos = [
      { _id: 'r1', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep1' },
      { _id: 'r2', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep2' },
    ];

    Repuestos.find = () => ({ lean: async () => repuestos });
    Repuestos.updateMany = async () => ({ acknowledged: true, modifiedCount: 2 });

    let reportCreateCount = 0;
    OT.create = async () => ({ _id: 'ot1', reportes: [], save: async () => {} });
    Report.create = async () => { reportCreateCount += 1; return { _id: `rep-created-${reportCreateCount}` }; };
    Report.find = () => ({ select: () => ({ lean: async () => [] }) });
    EquipoItem.findById = () => makePopulateLean({ _id: 'e1', ItemId: { Nombre: 'Equipo A' }, Marca: 'M', Serie: 'S' });

    let seq = 0;
    Counter.findOneAndUpdate = () => ({ lean: async () => ({ seq: ++seq }) });
    RepuestoTrazabilidad.create = async () => ({ _id: 't1' });

    const result = await repuestosService.createOtFromSolicitudes({
      repuestoIds: ['r1', 'r2'],
      ResponsableId: '507f1f77bcf86cd799439011',
    }, 'tenant-a');

    assert.equal(result.equiposProcesados, 1);
    assert.equal(reportCreateCount, 1);

    Repuestos.find = originals.repuestosFind;
    Repuestos.updateMany = originals.repuestosUpdateMany;
    OT.create = originals.otCreate;
    Report.create = originals.reportCreate;
    Report.find = originals.reportFind;
    EquipoItem.findById = originals.equipoFindById;
    Counter.findOneAndUpdate = originals.counterFindOneAndUpdate;
    RepuestoTrazabilidad.create = originals.trazCreate;
  });

  it('creates one report per equipment when selected repuestos span multiple equipments', async () => {
    const originals = {
      repuestosFind: Repuestos.find,
      repuestosUpdateMany: Repuestos.updateMany,
      otCreate: OT.create,
      reportCreate: Report.create,
      reportFind: Report.find,
      equipoFindById: EquipoItem.findById,
      counterFindOneAndUpdate: Counter.findOneAndUpdate,
      trazCreate: RepuestoTrazabilidad.create,
    };

    const repuestos = [
      { _id: 'r1', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep1' },
      { _id: 'r2', tenantId: 'tenant-a', EquipoId: 'e2', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep2' },
    ];

    Repuestos.find = () => ({ lean: async () => repuestos });
    Repuestos.updateMany = async () => ({ acknowledged: true, modifiedCount: 2 });

    let reportCreateCount = 0;
    OT.create = async () => ({ _id: 'ot2', reportes: [], save: async () => {} });
    Report.create = async () => { reportCreateCount += 1; return { _id: `rep-created-${reportCreateCount}` }; };
    Report.find = () => ({ select: () => ({ lean: async () => [] }) });
    EquipoItem.findById = (id) => makePopulateLean({ _id: id, ItemId: { Nombre: `Equipo ${id}` }, Marca: 'M', Serie: 'S' });

    let seq = 100;
    Counter.findOneAndUpdate = () => ({ lean: async () => ({ seq: ++seq }) });
    RepuestoTrazabilidad.create = async () => ({ _id: 't2' });

    const result = await repuestosService.createOtFromSolicitudes({
      repuestoIds: ['r1', 'r2'],
      ResponsableId: '507f1f77bcf86cd799439011',
    }, 'tenant-a');

    assert.equal(result.equiposProcesados, 2);
    assert.equal(reportCreateCount, 2);

    Repuestos.find = originals.repuestosFind;
    Repuestos.updateMany = originals.repuestosUpdateMany;
    OT.create = originals.otCreate;
    Report.create = originals.reportCreate;
    Report.find = originals.reportFind;
    EquipoItem.findById = originals.equipoFindById;
    Counter.findOneAndUpdate = originals.counterFindOneAndUpdate;
    RepuestoTrazabilidad.create = originals.trazCreate;
  });
});
