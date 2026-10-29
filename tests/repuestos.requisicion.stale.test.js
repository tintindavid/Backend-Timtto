/**
 * requisiciones-e2 adversarial fixes A6(a) (lazy self-heal of stale links) and B9 (update/delete fail closed without
 * tenant). DB-free: Mongoose statics are replaced by in-memory stubs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { repuestosService } from '../src/services/repuestos.service.js';
import { repuestoRequisicionService } from '../src/services/repuestoRequisicion.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';
import { Tenant } from '../src/models/tenant.model.js';
import { User } from '../src/models/user.model.js';
import { Requisicion } from '../src/models/requisicion.model.js';
import { InventarioMovimiento } from '../src/models/inventarioMovimiento.model.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

const oid = () => new mongoose.Types.ObjectId();
const T = 'tenant-a';
const ON = { usesRequisiciones: true };
const RESP = '507f1f77bcf86cd799439012';
const PLAIN_USER = { userId: 'u-1', permissions: [PERMISSIONS.REPUESTOS_CREATE] };

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
let savedEnforce;
let reqDocs;
let unlinked;
let traces;

beforeEach(() => {
  savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES;
  process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
  reqDocs = [];
  unlinked = [];
  traces = [];
  stub(Requisicion, 'find', (filter) => ({
    lean: async () => {
      const ids = filter._id.$in.map(String);
      return reqDocs.filter((d) => ids.includes(String(d._id)));
    },
  }));
  stub(Repuestos, 'updateOne', async (filter, update) => { unlinked.push({ filter, update }); return { modifiedCount: 1 }; });
  stub(RepuestoTrazabilidad, 'create', async (doc) => { traces.push(doc.Comentarios); return doc; });
  stub(Tenant, 'findOne', () => ({ lean: async () => ({ capabilities: { usesRequisiciones: true } }) }));
  stub(InventarioMovimiento, 'findOne', () => ({ select: () => ({ lean: async () => null }) }));
});
afterEach(() => {
  while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; }
  if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
});

const link = (disponibilidad, extra = {}) => ({ requisicionId: oid(), lineaId: oid(), consecutivo: 'REQ-2026-0001', disponibilidad, cantidadConfirmada: 0, ...extra });
const solicitud = (requisicion, over = {}) => ({ _id: 'r1', tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', updatedAt: new Date(0), requisicion, ...over });
function arrange(current) {
  stub(Repuestos, 'findOne', () => ({ lean: async () => current }));
  stub(Repuestos, 'findOneAndUpdate', async (filter, update) => ({ _id: filter._id, tenantId: T, ...update.$set, toJSON() { return {}; } }));
}

describe('adversarial B9: update / delete fail closed without a tenant', () => {
  it('no tenantId -> throws before any query (never an unscoped filter)', async () => {
    let queried = 0;
    stub(Repuestos, 'findOne', () => { queried += 1; return { lean: async () => ({ _id: 'r1', tenantId: T }) }; });
    stub(Repuestos, 'findOneAndUpdate', async () => { queried += 1; return {}; });
    for (const tenant of [undefined, null, '']) {
      await assert.rejects(() => repuestosService.update('r1', { observacion: 'x' }, tenant), /TenantId is required/);
      await assert.rejects(() => repuestosService.delete('r1', tenant), /TenantId is required/);
    }
    assert.equal(queried, 0);
  });
});

describe('adversarial A6a: stale links are released lazily instead of answering 409', () => {
  const stale = {
    'requisition missing': () => [],
    'requisition deleted': (id) => [{ _id: id, estado: 'Borrador', isDeleted: true, consecutivo: 'REQ-1', lineas: [] }],
    'requisition Rechazada': (id) => [{ _id: id, estado: 'Rechazada', consecutivo: 'REQ-1', lineas: [] }],
    'requisition Cancelada without confirmed goods': (id) => [{ _id: id, estado: 'Cancelada', consecutivo: 'REQ-1', lineas: [{ origenSolicitudRepuestoId: 'r1', estadoLinea: 'Pendiente', cantidadConfirmada: 0 }] }],
  };

  for (const [name, docs] of Object.entries(stale)) {
    it(`update with a link to a ${name}: released, trace written, no 409`, async () => {
      const l = link('En_Abastecimiento');
      arrange(solicitud(l));
      reqDocs = docs(l.requisicionId);
      await repuestosService.update('r1', { EstadoSolicitud: 'Instalado' }, T, ON);
      assert.equal(unlinked.length, 1);
      assert.deepEqual(unlinked[0].update, { $unset: { requisicion: 1 } });
      assert.ok(traces.some((c) => c.includes('enlace obsoleto liberado')));
    });
  }

  it('delete also releases a stale link and proceeds', async () => {
    const l = link('Recibida');
    arrange(solicitud(l));
    reqDocs = [{ _id: l.requisicionId, estado: 'Rechazada', consecutivo: 'REQ-1', lineas: [] }];
    await repuestosService.delete('r1', T, ON);
    assert.equal(unlinked.length, 1);
  });

  it('a Cancelada requisition with confirmed goods for that line is NOT stale', async () => {
    const l = link('Disponible', { cantidadConfirmada: 1 });
    arrange(solicitud(l));
    reqDocs = [{ _id: l.requisicionId, estado: 'Cancelada', consecutivo: 'REQ-1', lineas: [{ origenSolicitudRepuestoId: 'r1', estadoLinea: 'Confirmada', cantidadConfirmada: 1 }] }];
    await repuestosService.update('r1', { observacion: 'n' }, T, ON);
    assert.equal(unlinked.length, 0);
  });

  it('a young link to a requisition that does not exist yet (in-flight claim) is respected', async () => {
    const l = link('En_Requisicion');
    arrange(solicitud(l, { updatedAt: new Date() }));
    await assert.rejects(() => repuestosService.update('r1', { EstadoSolicitud: 'Instalado' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    assert.equal(unlinked.length, 0);
  });

  it('a live requisition keeps the lock (409) and never releases', async () => {
    const l = link('En_Abastecimiento');
    arrange(solicitud(l));
    reqDocs = [{ _id: l.requisicionId, estado: 'En_Recepcion', consecutivo: 'REQ-1', lineas: [] }];
    await assert.rejects(() => repuestosService.update('r1', { EstadoSolicitud: 'Instalado' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    assert.equal(unlinked.length, 0);
  });

  it('A4: the stock marker is cleared with the link when no stock pair was posted', async () => {
    const l = link('En_Abastecimiento');
    arrange(solicitud(l, { stockDescontadoPor: 'requisicion', InventarioItemId: oid() }));
    reqDocs = [{ _id: l.requisicionId, estado: 'Rechazada', consecutivo: 'REQ-1', lineas: [] }];
    await repuestosService.update('r1', { observacion: 'n' }, T, ON);
    assert.deepEqual(unlinked[0].update, { $unset: { requisicion: 1, stockDescontadoPor: 1 } });
  });

  it('A4: with a posted stock pair the link and the marker are kept (consistency), the lock stays', async () => {
    const l = link('En_Abastecimiento');
    arrange(solicitud(l, { stockDescontadoPor: 'requisicion', InventarioItemId: oid() }));
    reqDocs = [{ _id: l.requisicionId, estado: 'Rechazada', consecutivo: 'REQ-1', lineas: [] }];
    stub(InventarioMovimiento, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: 'm' }) }) }));
    await assert.rejects(() => repuestosService.update('r1', { EstadoSolicitud: 'Instalado' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    assert.equal(unlinked.length, 0);
  });

  it('createOtFromSolicitudes: a stale link counts as unlinked (REQUIERE_REQUISICION, not SOLICITUD_NO_DISPONIBLE)', async () => {
    const l = link('En_Abastecimiento');
    const rows = [{ _id: 'a', tenantId: T, EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', updatedAt: new Date(0), requisicion: l }];
    stub(Repuestos, 'find', () => ({ lean: async () => rows }));
    stub(User, 'find', () => ({ populate: () => ({ lean: async () => [{ _id: RESP, tenantId: T, isDeleted: false, roleId: { permissions: ['ots:can-be-responsible'] } }] }) }));
    reqDocs = [{ _id: l.requisicionId, estado: 'Cancelada', consecutivo: 'REQ-1', lineas: [{ origenSolicitudRepuestoId: 'a', estadoLinea: 'Cancelada', cantidadConfirmada: 0 }] }];
    await assert.rejects(
      () => repuestosService.createOtFromSolicitudes({ repuestoIds: ['a'], responsableUserIds: [RESP], fechaInicio: new Date().toISOString(), fechaFin: new Date().toISOString() }, T, PLAIN_USER, { capabilities: ON }),
      (e) => e.code === 'REQUIERE_REQUISICION',
    );
    assert.equal(unlinked.length, 1);
  });

  it('claim (_loadEligible): a stale link is healed and the solicitud can be claimed again', async () => {
    const l = link('En_Aprobacion');
    const rows = [{ _id: oid(), tenantId: T, EstadoSolicitud: 'Solicitado', updatedAt: new Date(0), requisicion: l }];
    stub(Repuestos, 'find', () => ({ lean: async () => rows }));
    reqDocs = [{ _id: l.requisicionId, estado: 'Rechazada', consecutivo: 'REQ-1', lineas: [] }];
    const out = await repuestoRequisicionService._loadEligible(T, [String(rows[0]._id)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].requisicion, undefined);
  });

  it('claim (_loadEligible): a live link still answers 409 SOLICITUD_YA_VINCULADA', async () => {
    const l = link('En_Aprobacion');
    const rows = [{ _id: oid(), tenantId: T, EstadoSolicitud: 'Solicitado', updatedAt: new Date(0), requisicion: l }];
    stub(Repuestos, 'find', () => ({ lean: async () => rows }));
    reqDocs = [{ _id: l.requisicionId, estado: 'En_Aprobacion', consecutivo: 'REQ-1', lineas: [] }];
    await assert.rejects(() => repuestoRequisicionService._loadEligible(T, [String(rows[0]._id)]), (e) => e.code === 'SOLICITUD_YA_VINCULADA');
  });

  it('getById: a stale link is released and not exposed', async () => {
    const l = link('Recibida');
    const doc = { ...solicitud(l), toObject() { const { toObject, ...rest } = this; return rest; } };
    let calls = 0;
    stub(Repuestos, 'findOne', () => { calls += 1; return Promise.resolve(calls === 1 ? doc : { ...solicitud(undefined), toJSON() { return {}; } }); });
    const out = await repuestosService.getById('r1', T, ON);
    assert.equal(out.requisicion, undefined);
    assert.equal(calls, 2);
  });
});
