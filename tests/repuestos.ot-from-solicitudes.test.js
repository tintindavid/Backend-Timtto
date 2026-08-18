import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { repuestosService } from '../src/services/repuestos.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { OT } from '../src/models/ot.model.js';
import { Report } from '../src/models/report.model.js';
import { EquipoItem } from '../src/models/equipoitem.model.js';
import { Counter } from '../src/models/counter.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';
import { User } from '../src/models/user.model.js';
import { Customer } from '../src/models/customer.model.js';
import { notificationService } from '../src/services/notification.service.js';

function makePopulateLean(data) {
  return {
    populate() { return this; },
    lean: async () => data,
  };
}

const RESP_A = '507f1f77bcf86cd799439011';
const RESP_B = '507f1f77bcf86cd799439012';
const TODAY = new Date();
const FUTURE_START = new Date(TODAY.getTime() + 24 * 3600 * 1000).toISOString();
const FUTURE_END = new Date(TODAY.getTime() + 3 * 24 * 3600 * 1000).toISOString();

function eligibleUsers(ids) {
  return ids.map((id) => ({
    _id: id,
    tenantId: 'tenant-a',
    isDeleted: false,
    firstName: 'Test',
    lastName: 'User',
    roleId: { permissions: ['ots:can-be-responsible'] },
  }));
}

const stubs = [];
function stub(target, key, value) {
  stubs.push([target, key, target[key]]);
  target[key] = value;
}

function commonStubs({ repuestos, equipoIds }) {
  stub(Repuestos, 'find', () => ({ lean: async () => repuestos }));
  stub(Repuestos, 'updateMany', async () => ({ acknowledged: true, modifiedCount: repuestos.length }));
  stub(OT, 'create', async () => ({ _id: 'ot-created', Consecutivo: 'OT000001', reportes: [], save: async () => {} }));
  stub(Report, 'create', async () => ({ _id: 'rep-created' }));
  stub(Report, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  stub(EquipoItem, 'findById', (id) => makePopulateLean({ _id: id, ItemId: { Nombre: `Equipo ${id}` }, Marca: 'M', Serie: 'S' }));
  let seq = 0;
  stub(Counter, 'findOneAndUpdate', () => ({ lean: async () => ({ seq: ++seq }) }));
  stub(RepuestoTrazabilidad, 'create', async () => ({ _id: 'traz' }));
  stub(User, 'find', () => ({
    populate: () => ({ lean: async () => eligibleUsers(equipoIds ? [RESP_A] : [RESP_A]) }),
  }));
  stub(Customer, 'findById', () => ({ select: () => ({ lean: async () => ({ Razonsocial: 'Cliente X' }) }) }));
  stub(notificationService, 'emit', async () => ({ dispatched: 0, recipients: [] }));
}

describe('repuestosService.createOtFromSolicitudes', () => {
  afterEach(() => {
    while (stubs.length) {
      const [target, key, original] = stubs.pop();
      target[key] = original;
    }
  });

  it('creates one report when all selected repuestos share the same equipment', async () => {
    const repuestos = [
      { _id: 'r1', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep1' },
      { _id: 'r2', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep2' },
    ];
    commonStubs({ repuestos });
    let reportCreateCount = 0;
    Report.create = async () => { reportCreateCount += 1; return { _id: `rep-created-${reportCreateCount}` }; };

    const result = await repuestosService.createOtFromSolicitudes({
      repuestoIds: ['r1', 'r2'],
      responsableUserIds: [RESP_A],
      fechaInicio: FUTURE_START,
      fechaFin: FUTURE_END,
    }, 'tenant-a', { userId: 'admin-1', firstName: 'Admin', lastName: 'X' });

    assert.equal(result.equiposProcesados, 1);
    assert.equal(reportCreateCount, 1);
  });

  it('creates one report per equipment when selected repuestos span multiple equipments', async () => {
    const repuestos = [
      { _id: 'r1', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep1' },
      { _id: 'r2', tenantId: 'tenant-a', EquipoId: 'e2', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep2' },
    ];
    commonStubs({ repuestos });
    let reportCreateCount = 0;
    Report.create = async () => { reportCreateCount += 1; return { _id: `rep-created-${reportCreateCount}` }; };

    const result = await repuestosService.createOtFromSolicitudes({
      repuestoIds: ['r1', 'r2'],
      responsableUserIds: [RESP_A],
      fechaInicio: FUTURE_START,
      fechaFin: FUTURE_END,
    }, 'tenant-a', { userId: 'admin-1', firstName: 'Admin', lastName: 'X' });

    assert.equal(result.equiposProcesados, 2);
    assert.equal(reportCreateCount, 2);
  });

  it('rejects when selected repuestos belong to different clients', async () => {
    const repuestos = [
      { _id: 'r1', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1' },
      { _id: 'r2', tenantId: 'tenant-a', EquipoId: 'e2', EstadoSolicitud: 'Solicitado', ClienteId: 'c2' },
    ];
    commonStubs({ repuestos });

    let thrown = null;
    try {
      await repuestosService.createOtFromSolicitudes({
        repuestoIds: ['r1', 'r2'],
        responsableUserIds: [RESP_A],
        fechaInicio: FUTURE_START,
        fechaFin: FUTURE_END,
      }, 'tenant-a', { userId: 'admin-1' });
    } catch (err) { thrown = err; }

    assert.ok(thrown);
    assert.equal(thrown.code, 'MULTIPLE_CLIENTS');
  });

  it('rejects a foreign-tenant responsable userId', async () => {
    const repuestos = [
      { _id: 'r1', tenantId: 'tenant-a', EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1' },
    ];
    commonStubs({ repuestos });
    // Override User.find to return empty (foreign userId not in tenant).
    User.find = () => ({ populate: () => ({ lean: async () => [] }) });

    let thrown = null;
    try {
      await repuestosService.createOtFromSolicitudes({
        repuestoIds: ['r1'],
        responsableUserIds: [RESP_B],
        fechaInicio: FUTURE_START,
        fechaFin: FUTURE_END,
      }, 'tenant-a', { userId: 'admin-1' });
    } catch (err) { thrown = err; }

    assert.ok(thrown);
    assert.equal(thrown.code, 'INVALID_RESPONSABLE_USER_IDS');
  });
});
