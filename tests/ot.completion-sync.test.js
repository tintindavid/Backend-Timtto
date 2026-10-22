import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { oTService } from '../src/services/ot.service.js';
import { OT } from '../src/models/ot.model.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { Tenant } from '../src/models/tenant.model.js';
import { InventarioRepuesto } from '../src/models/inventarioRepuesto.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';
import { inventarioMovimientoService } from '../src/services/inventarioMovimiento.service.js';
import { ApiError } from '../src/utils/apiError.util.js';

// inventario-stock: on OT completion the linked spare parts are marked Instalado (always) and stock is discounted
// through a kardex "salida" ONLY for tenants with usesInventoryAdvanced.
describe('oTService.update completion sync', () => {
  const originals = {};
  let tenantCapabilities;
  let movementCalls;
  let movementError;
  let repuestoSaved;
  let trazCount;
  let invDirectWrites;
  let savedEnforce;

  beforeEach(() => {
    savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES;
    delete process.env.ENFORCE_TENANT_CAPABILITIES;
    Object.assign(originals, {
      startSession: OT.startSession,
      findOne: OT.findOne,
      findOneAndUpdate: OT.findOneAndUpdate,
      repuestosFind: Repuestos.find,
      invFindOneAndUpdate: InventarioRepuesto.findOneAndUpdate,
      trazCreate: RepuestoTrazabilidad.create,
      tenantFindOne: Tenant.findOne,
      movCreate: inventarioMovimientoService.create,
    });
    tenantCapabilities = {};
    movementCalls = [];
    movementError = null;
    repuestoSaved = 0;
    trazCount = 0;
    invDirectWrites = 0;

    OT.startSession = async () => ({
      withTransaction: async (fn) => fn(),
      endSession: async () => {},
    });
    OT.findOne = () => ({ session: async () => ({ _id: 'ot1', Consecutivo: 'OT-000001', EstadoOt: 'En Progreso' }) });
    OT.findOneAndUpdate = async () => ({ _id: 'ot1', EstadoOt: 'Completado' });
    Repuestos.find = () => ({
      session: async () => [{
        _id: 'r1',
        InventarioItemId: 'inv1',
        CantidadInstalacion: 2,
        EstadoSolicitud: 'En Proceso',
        save: async () => { repuestoSaved += 1; },
      }],
    });
    Tenant.findOne = () => ({ lean: async () => ({ capabilities: tenantCapabilities }) });
    InventarioRepuesto.findOneAndUpdate = async () => { invDirectWrites += 1; return null; };
    inventarioMovimientoService.create = async (...args) => {
      movementCalls.push(args);
      if (movementError) throw movementError;
      return { movimiento: {}, item: {} };
    };
    RepuestoTrazabilidad.create = async () => { trazCount += 1; return [{ _id: 't1' }]; };
  });

  afterEach(() => {
    OT.startSession = originals.startSession;
    OT.findOne = originals.findOne;
    OT.findOneAndUpdate = originals.findOneAndUpdate;
    Repuestos.find = originals.repuestosFind;
    InventarioRepuesto.findOneAndUpdate = originals.invFindOneAndUpdate;
    RepuestoTrazabilidad.create = originals.trazCreate;
    Tenant.findOne = originals.tenantFindOne;
    inventarioMovimientoService.create = originals.movCreate;
    if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
    else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
  });

  it('advanced tenant: marks repuestos Instalado, writes trazabilidad and records a salida referenced to the OT', async () => {
    tenantCapabilities = { usesInventoryBasic: true, usesInventoryAdvanced: true };
    const result = await oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' });

    assert.equal(result.EstadoOt, 'Completado');
    assert.equal(repuestoSaved, 1);
    assert.equal(trazCount, 1);
    assert.equal(movementCalls.length, 1);
    const [tenantId, data, userId] = movementCalls[0];
    assert.equal(tenantId, 'tenant-a');
    assert.equal(data.itemId, 'inv1');
    assert.equal(data.tipo, 'salida');
    assert.equal(data.cantidad, 2);
    assert.equal(data.referenciaTipo, 'OT');
    assert.equal(data.referenciaId, 'ot1');
    assert.equal(userId, 'u1');
    assert.equal(invDirectWrites, 0, 'stock only changes through the movements service');
  });

  it('basic tenant: the OT completes without validating or touching stock', async () => {
    tenantCapabilities = { usesInventoryBasic: true };
    const result = await oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' });
    assert.equal(result.EstadoOt, 'Completado');
    assert.equal(repuestoSaved, 1);
    assert.equal(trazCount, 1);
    assert.equal(movementCalls.length, 0);
    assert.equal(invDirectWrites, 0);
  });

  it('tenant without any inventory capability behaves like basic', async () => {
    tenantCapabilities = {};
    await oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' });
    assert.equal(movementCalls.length, 0);
    assert.equal(repuestoSaved, 1);
  });

  it('warn rollout mode keeps the legacy discount for tenants not migrated yet', async () => {
    process.env.ENFORCE_TENANT_CAPABILITIES = 'warn';
    await oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' });
    assert.equal(movementCalls.length, 1);
  });

  it('advanced tenant with insufficient stock: the completion fails with 400 INSUFFICIENT_STOCK and nothing is marked Instalado', async () => {
    tenantCapabilities = { usesInventoryBasic: true, usesInventoryAdvanced: true };
    movementError = new ApiError(400, 'Stock insuficiente', 'INSUFFICIENT_STOCK');
    await assert.rejects(
      () => oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' }),
      (e) => e.statusCode === 400 && e.code === 'INSUFFICIENT_STOCK',
    );
    assert.equal(repuestoSaved, 0);
    assert.equal(trazCount, 0);
  });

  it('double completion: the EstadoOt != Completado precondition rejects the second one with 409 and nothing is discounted', async () => {
    tenantCapabilities = { usesInventoryBasic: true, usesInventoryAdvanced: true };
    let seenFilter;
    OT.findOneAndUpdate = async (filter) => { seenFilter = filter; return null; };
    await assert.rejects(
      () => oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' }),
      (e) => e.statusCode === 409 && e.code === 'OT_ALREADY_COMPLETED',
    );
    assert.deepEqual(seenFilter.EstadoOt, { $ne: 'Completado' });
    assert.equal(movementCalls.length, 0);
    assert.equal(repuestoSaved, 0);
  });

  it('partial failure across repuestos (no txn): applied salidas are reversed and the previous EstadoOt restored', async () => {
    tenantCapabilities = { usesInventoryBasic: true, usesInventoryAdvanced: true };
    const mk = (id, item) => ({
      _id: id, InventarioItemId: item, CantidadInstalacion: 3, EstadoSolicitud: 'En Proceso',
      save: async () => { repuestoSaved += 1; },
    });
    const otDoc = { _id: 'ot1', Consecutivo: 'OT-000001', EstadoOt: 'En Progreso' };
    OT.findOne = () => ({ session: async () => otDoc, then: (res, rej) => Promise.resolve(otDoc).then(res, rej) });
    const docs = [mk('r1', 'inv1'), mk('r2', 'inv2')];
    Repuestos.find = () => ({ session: async () => docs, then: (res, rej) => Promise.resolve(docs).then(res, rej) });
    // Standalone mongod: the transaction attempt fails with code 20 and the op re-runs without a session.
    OT.startSession = async () => ({
      withTransaction: async (fn) => { const e = new Error('no txn'); e.code = 20; throw e; },
      endSession: async () => {},
    });
    const updates = [];
    OT.findOneAndUpdate = async (f, u) => { updates.push(u); return { _id: 'ot1', EstadoOt: u.$set.EstadoOt }; };
    inventarioMovimientoService.create = async (...args) => {
      movementCalls.push(args);
      if (args[1].itemId === 'inv2' && args[1].tipo === 'salida') throw new ApiError(400, 'Stock insuficiente', 'INSUFFICIENT_STOCK');
      return { movimiento: {}, item: {} };
    };
    await assert.rejects(
      () => oTService.update('ot1', { EstadoOt: 'Completado' }, 'tenant-a', { userId: 'u1' }),
      (e) => e.code === 'INSUFFICIENT_STOCK',
    );
    const kinds = movementCalls.map((c) => `${c[1].tipo}:${c[1].itemId}`);
    assert.deepEqual(kinds, ['salida:inv1', 'salida:inv2', 'entrada:inv1']);
    assert.deepEqual(updates[updates.length - 1], { $set: { EstadoOt: 'En Progreso' } });
    assert.equal(repuestoSaved, 0, 'no repuesto is marked Instalado');
    assert.equal(trazCount, 0);
  });
});
