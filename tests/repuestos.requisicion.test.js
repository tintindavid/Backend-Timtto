/**
 * requisiciones-e2-solicitudes-recepcion, groups 2 and 5 (DB-free): conversion rules, the locks of RepuestosService,
 * the OT creation rules, the module-off guarantees (nothing about requisitions is checked or exposed), DTOs, the
 * route guards and the controller envelope. The real flows against a mongod live in
 * tests/integration/requisicion.e2.mongo.integration.test.js.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import sift from 'sift';

import { repuestosService } from '../src/services/repuestos.service.js';
import { repuestoRequisicionService, parseCantidad } from '../src/services/repuestoRequisicion.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { OT } from '../src/models/ot.model.js';
import { Report } from '../src/models/report.model.js';
import { EquipoItem } from '../src/models/equipoitem.model.js';
import { Counter } from '../src/models/counter.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';
import { User } from '../src/models/user.model.js';
import { Customer } from '../src/models/customer.model.js';
import { Tenant } from '../src/models/tenant.model.js';
import { Requisicion } from '../src/models/requisicion.model.js';
import { InventarioRepuesto } from '../src/models/inventarioRepuesto.model.js';
import { notificationService } from '../src/services/notification.service.js';
import { repuestosController } from '../src/controllers/repuestos.controller.js';
import router from '../src/routes/repuestos.routes.js';
import { createRequisicionFromSolicitudesDto } from '../src/dtos/createRequisicionFromSolicitudes.dto.js';
import { createOtFromSolicitudesDto } from '../src/dtos/createOtFromSolicitudes.dto.js';
import { queryRepuestosDto } from '../src/dtos/queryRepuestos.dto.js';
import { PERMISSIONS } from '../src/constants/permissions.js';
import { presentRepuesto } from '../src/utils/repuestoRequisicion.util.js';

const oid = () => new mongoose.Types.ObjectId();
const OID = '507f1f77bcf86cd799439011';
const T = 'tenant-a';
const ON = { usesRequisiciones: true };
const OFF = { usesRequisiciones: false };
const RESP = '507f1f77bcf86cd799439012';
const MANAGER = { userId: 'u-mgr', permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] };
const PLAIN_USER = { userId: 'u-1', permissions: [PERMISSIONS.REPUESTOS_CREATE] };

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
let savedEnforce;
// The capability guard must enforce (a developer .env may relax it to warn/off).
// Requisitions the lazy self-heal looks up: by default every linked requisition is alive (En_Recepcion); tests set `reqDocs`.
let reqDocs = null;
const reqLookups = [];
beforeEach(() => {
  savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES; process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
  reqDocs = null;
  reqLookups.length = 0;
  stub(Requisicion, 'find', (filter) => ({
    lean: async () => {
      const ids = filter._id.$in.map(String);
      reqLookups.push(filter);
      if (reqDocs) return reqDocs.filter((d) => ids.includes(String(d._id)));
      return ids.map((id) => ({ _id: id, estado: 'En_Recepcion', consecutivo: 'REQ-2026-0001', lineas: [] }));
    },
  }));
});
afterEach(() => {
  while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; }
  if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
});

const link = (disponibilidad, extra = {}) => ({ requisicionId: oid(), lineaId: oid(), consecutivo: 'REQ-2026-0001', disponibilidad, cantidadConfirmada: 0, ...extra });

// ------------------------------------------------------------------------------------------------ update / delete

describe('RepuestosService.update / delete: requisition locks', () => {
  let written;
  let tenantLookups;
  function arrange(current) {
    written = [];
    tenantLookups = 0;
    stub(Repuestos, 'findOne', (f) => ({ lean: async () => (current && f.tenantId && f.tenantId !== current.tenantId ? null : current) }));
    stub(Repuestos, 'findOneAndUpdate', async (filter, update) => { written.push(update); return { _id: filter._id, tenantId: current.tenantId, requisicion: current.requisicion, toJSON() { return {}; }, ...update.$set }; });
    stub(RepuestoTrazabilidad, 'create', async () => ({}));
    stub(Tenant, 'findOne', () => { tenantLookups += 1; return { lean: async () => ({ capabilities: { usesRequisiciones: true } }) }; });
  }
  const pending = (over = {}) => ({ _id: 'r1', tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', requisicion: link('En_Abastecimiento'), ...over });

  it('a linked, not available solicitud cannot be installed or sent to process: 409 SOLICITUD_EN_REQUISICION and nothing is written', async () => {
    arrange(pending());
    for (const estado of ['Instalado', 'En Proceso']) {
      await assert.rejects(
        () => repuestosService.update('r1', { EstadoSolicitud: estado }, T, ON),
        (e) => e.statusCode === 409 && e.code === 'SOLICITUD_EN_REQUISICION'
          && e.details.consecutivo === 'REQ-2026-0001' && e.details.disponibilidad === 'En_Abastecimiento' && Boolean(e.details.requisicionId),
      );
    }
    assert.equal(written.length, 0);
  });

  it('every pre-available disponibilidad locks it', async () => {
    for (const d of ['En_Requisicion', 'En_Aprobacion', 'En_Abastecimiento', 'Recibida', 'En_Disputa']) {
      arrange(pending({ requisicion: link(d) }));
      await assert.rejects(() => repuestosService.update('r1', { EstadoSolicitud: 'Instalado' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION', d);
    }
  });

  it('nombre and Cantidad cannot change while locked, but an unchanged value is not an edit', async () => {
    arrange(pending());
    await assert.rejects(() => repuestosService.update('r1', { nombre: 'Otro' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    await assert.rejects(() => repuestosService.update('r1', { Cantidad: '5' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    await assert.rejects(() => repuestosService.update('r1', { Cantidad: 5 }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    assert.equal(written.length, 0);
    // the form sends the whole object: same name/quantity + another field is fine
    await repuestosService.update('r1', { nombre: 'Sensor', Cantidad: 2, observacion: 'nota' }, T, ON);
    assert.equal(written.length, 1);
    // ANY status change is locked (B1); its current state is not a change
    await assert.rejects(() => repuestosService.update('r1', { EstadoSolicitud: 'Rechazado' }, T, ON), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    await repuestosService.update('r1', { EstadoSolicitud: 'Solicitado' }, T, ON);
    assert.equal(written.length, 2);
  });

  it('a Disponible solicitud is installed and edited with the usual flow', async () => {
    arrange(pending({ requisicion: link('Disponible', { cantidadConfirmada: 2 }) }));
    await repuestosService.update('r1', { EstadoSolicitud: 'Instalado', nombre: 'Sensor X', Cantidad: '3' }, T, ON);
    assert.equal(written.length, 1);
  });

  it('security H1: a solicitud of another tenant is a 404 on update and delete (nothing is written)', async () => {
    arrange(pending({ tenantId: 'tenant-b', requisicion: undefined }));
    await assert.rejects(() => repuestosService.update('r1', { observacion: 'hack' }, T, ON), (e) => e.statusCode === 404);
    await assert.rejects(() => repuestosService.delete('r1', T, ON), (e) => e.statusCode === 404);
    assert.equal(written.length, 0);
  });

  it('security H2: ResponsableSolicitud cannot be reassigned while the solicitud is linked and pending', async () => {
    arrange(pending({ ResponsableSolicitud: RESP }));
    await assert.rejects(() => repuestosService.update('r1', { ResponsableSolicitud: OID }, T, ON), (e) => e.statusCode === 409 && e.code === 'SOLICITUD_EN_REQUISICION');
    assert.equal(written.length, 0);
    // the same value (the form sends the whole object) is not an edit
    await repuestosService.update('r1', { ResponsableSolicitud: RESP, observacion: 'n' }, T, ON);
    assert.equal(written.length, 1);
    // module OFF or unlinked: free, as before
    arrange(pending({ ResponsableSolicitud: RESP }));
    await repuestosService.update('r1', { ResponsableSolicitud: OID }, T, OFF);
    arrange(pending({ ResponsableSolicitud: RESP, requisicion: undefined }));
    await repuestosService.update('r1', { ResponsableSolicitud: OID }, T, ON);
    assert.equal(written.length, 1);
  });

  it('an unlinked solicitud never triggers the module lookup', async () => {
    arrange(pending({ requisicion: undefined }));
    await repuestosService.update('r1', { EstadoSolicitud: 'Instalado', nombre: 'x' }, T);
    assert.equal(written.length, 1);
    assert.equal(tenantLookups, 0);
  });

  it('module OFF: a stale link locks nothing and is not exposed', async () => {
    arrange(pending());
    const out = await repuestosService.update('r1', { EstadoSolicitud: 'Instalado', nombre: 'Otro' }, T, OFF);
    assert.equal(written.length, 1);
    assert.equal('requisicion' in out, false);
    assert.equal('stockDescontadoPor' in out, false);
  });

  it('without capabilities in the call the tenant is read from the database (never trusted from the caller)', async () => {
    arrange(pending());
    await assert.rejects(() => repuestosService.update('r1', { EstadoSolicitud: 'Instalado' }, T), (e) => e.code === 'SOLICITUD_EN_REQUISICION');
    assert.equal(tenantLookups, 1);
  });

  it('delete: 409 for a pending linked solicitud, allowed when Disponible, unlinked or with the module off', async () => {
    arrange(pending());
    await assert.rejects(() => repuestosService.delete('r1', T, ON), (e) => e.statusCode === 409 && e.code === 'SOLICITUD_EN_REQUISICION' && e.details.disponibilidad === 'En_Abastecimiento');
    assert.equal(written.length, 0);

    await repuestosService.delete('r1', T, OFF);
    assert.equal(written.length, 1);

    arrange(pending({ requisicion: link('Disponible') }));
    await repuestosService.delete('r1', T, ON);
    assert.equal(written.length, 1);

    arrange(pending({ requisicion: undefined }));
    await repuestosService.delete('r1', T, ON);
    assert.equal(written.length, 1);
    assert.equal(tenantLookups, 0);
  });

  it('delete of a missing solicitud keeps the 404', async () => {
    arrange(null);
    stub(Repuestos, 'findOneAndUpdate', async () => null);
    await assert.rejects(() => repuestosService.delete('nope', T, ON), (e) => e.statusCode === 404);
  });
});

// ------------------------------------------------------------------------------------------------ createOtFromSolicitudes

describe('RepuestosService.createOtFromSolicitudes: requisition rules', () => {
  let found;
  let updateManyFilter;
  let traceComments;
  let otCreated;

  function arrange(repuestos) {
    found = repuestos;
    updateManyFilter = null;
    traceComments = [];
    otCreated = 0;
    stub(Repuestos, 'find', () => ({ lean: async () => found }));
    stub(Repuestos, 'updateMany', async (filter) => { updateManyFilter = filter; return { modifiedCount: found.length }; });
    stub(OT, 'create', async () => { otCreated += 1; return { _id: 'ot-1', Consecutivo: 'OT000001', reportes: [], save: async () => {} }; });
    stub(Report, 'create', async () => ({ _id: 'rep-1' }));
    stub(EquipoItem, 'findOne', () => ({ populate() { return this; }, lean: async () => ({ Marca: 'M' }) }));
    let seq = 0;
    stub(Counter, 'findOneAndUpdate', () => ({ lean: async () => ({ seq: ++seq }) }));
    stub(RepuestoTrazabilidad, 'create', async (doc) => { traceComments.push(doc.Comentarios); return doc; });
    stub(User, 'find', () => ({ populate: () => ({ lean: async () => [{ _id: RESP, tenantId: T, isDeleted: false, firstName: 'A', lastName: 'B', roleId: { permissions: ['ots:can-be-responsible'] } }] }) }));
    stub(Customer, 'findById', () => ({ select: () => ({ lean: async () => ({ Razonsocial: 'C' }) }) }));
    stub(notificationService, 'emit', async () => ({ dispatched: 0 }));
  }
  const sol = (id, over = {}) => ({ _id: id, tenantId: T, EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep1', ...over });
  const body = (ids, extra = {}) => ({
    repuestoIds: ids,
    responsableUserIds: [RESP],
    fechaInicio: new Date(Date.now() + 86400000).toISOString(),
    fechaFin: new Date(Date.now() + 3 * 86400000).toISOString(),
    ...extra,
  });
  const create = (ids, extra, actor = PLAIN_USER, caps = ON) => repuestosService.createOtFromSolicitudes(body(ids, extra), T, actor, { capabilities: caps });

  it('all Disponible -> the OT is created as before', async () => {
    arrange([sol('a', { requisicion: link('Disponible') }), sol('b', { requisicion: link('Disponible') })]);
    const out = await create(['a', 'b']);
    assert.equal(out.repuestosActualizados, 2);
    assert.equal(otCreated, 1);
  });

  it('a linked solicitud that is not Disponible -> 409 SOLICITUD_NO_DISPONIBLE with the ids, no OT', async () => {
    arrange([sol('a', { requisicion: link('Disponible') }), sol('b', { requisicion: link('Recibida') }), sol('c', { requisicion: link('En_Aprobacion') })]);
    await assert.rejects(() => create(['a', 'b', 'c']), (e) => e.statusCode === 409 && e.code === 'SOLICITUD_NO_DISPONIBLE' && JSON.stringify(e.details.ids) === JSON.stringify(['b', 'c']));
    assert.equal(otCreated, 0);
    assert.equal(updateManyFilter, null);
  });

  it('a solicitud with no requisition -> 409 REQUIERE_REQUISICION with the ids, no OT', async () => {
    arrange([sol('a', { requisicion: link('Disponible') }), sol('b')]);
    await assert.rejects(() => create(['a', 'b']), (e) => e.statusCode === 409 && e.code === 'REQUIERE_REQUISICION' && JSON.stringify(e.details.ids) === JSON.stringify(['b']));
    assert.equal(otCreated, 0);
  });

  it('when both problems exist the linked-but-pending one is reported first', async () => {
    arrange([sol('a'), sol('b', { requisicion: link('En_Abastecimiento') })]);
    await assert.rejects(() => create(['a', 'b']), (e) => e.code === 'SOLICITUD_NO_DISPONIBLE');
  });

  it('omitirRequisicion without requisiciones:manage-all -> 403 and no OT', async () => {
    arrange([sol('a')]);
    await assert.rejects(() => create(['a'], { omitirRequisicion: true, motivoOmision: 'Urgente' }), (e) => e.statusCode === 403);
    assert.equal(otCreated, 0);
  });

  it('omitirRequisicion needs a reason (400) even for a manager', async () => {
    arrange([sol('a')]);
    for (const motivoOmision of [undefined, '', '   ']) {
      await assert.rejects(() => create(['a'], { omitirRequisicion: true, motivoOmision }, MANAGER), (e) => e.statusCode === 400 && e.code === 'MOTIVO_REQUERIDO');
    }
    assert.equal(otCreated, 0);
  });

  it('a manage-all user can skip the requisition: the OT is created and the reason is in the trace of EVERY solicitud', async () => {
    arrange([sol('a'), sol('b', { requisicion: link('Disponible') })]);
    const out = await create(['a', 'b'], { omitirRequisicion: true, motivoOmision: 'Paciente crítico' }, MANAGER);
    assert.equal(out.repuestosActualizados, 2);
    assert.equal(traceComments.length, 2);
    for (const c of traceComments) {
      assert.match(c, /Automatic: created in OT ot-1/);
      assert.match(c, /Requisición omitida por u-mgr: Paciente crítico/);
    }
  });

  it('superadmin counts as manage-all', async () => {
    arrange([sol('a')]);
    await create(['a'], { omitirRequisicion: true, motivoOmision: 'Soporte' }, { userId: 'sa', role: 'superadmin', permissions: [] });
    assert.equal(otCreated, 1);
  });

  it('the bulk state update is guarded by EstadoSolicitud and the tenant', async () => {
    arrange([sol('a', { requisicion: link('Disponible') })]);
    await create(['a']);
    assert.equal(updateManyFilter.tenantId, T);
    assert.deepEqual(updateManyFilter.EstadoSolicitud, { $in: ['Solicitado', null] });
  });

  it('module OFF: no requisition rule runs (not even with a stale link), and omitirRequisicion is ignored', async () => {
    arrange([sol('a'), sol('b', { requisicion: link('En_Aprobacion') })]);
    const out = await create(['a', 'b'], { omitirRequisicion: true, motivoOmision: 'ignorado' }, PLAIN_USER, OFF);
    assert.equal(out.repuestosActualizados, 2);
    for (const c of traceComments) assert.doesNotMatch(c, /omitida/);
    assert.equal(otCreated, 1);
  });

  it('module OFF with no flags at all behaves like a legacy tenant', async () => {
    arrange([sol('a')]);
    const out = await repuestosService.createOtFromSolicitudes(body(['a']), T, PLAIN_USER, { capabilities: { executesServices: true } });
    assert.equal(out.repuestosActualizados, 1);
  });
});

// ------------------------------------------------------------------------------------------------ list / getters

describe('Repuestos list and getters: requisition fields only with the module on', () => {
  let query;
  const rows = () => [
    { _id: 'r1', tenantId: T, nombre: 'A', requisicion: link('Disponible', { cantidadConfirmada: 2 }), stockDescontadoPor: 'requisicion' },
    { _id: 'r2', tenantId: T, nombre: 'B' },
  ];
  function arrange() {
    query = null;
    const chain = (data) => {
      const c = { populate: () => c, sort: () => c, skip: () => c, limit: () => c, lean: async () => data };
      return c;
    };
    stub(Repuestos, 'find', (q) => { query = q; return chain(rows()); });
    stub(Repuestos, 'countDocuments', async () => 2);
  }

  it('module ON: linked rows carry the summary (and only the summary); unlinked rows carry nothing', async () => {
    arrange();
    const out = await repuestosService.list({}, {}, T, ON);
    const [a, b] = out.data;
    assert.deepEqual(Object.keys(a.requisicion).sort(), ['cantidadConfirmada', 'consecutivo', 'disponibilidad', 'lineaId', 'requisicionId']);
    assert.equal(a.requisicion.disponibilidad, 'Disponible');
    assert.equal(a.requisicion.cantidadConfirmada, 2);
    assert.equal('stockDescontadoPor' in a, false, 'internal marker never leaves');
    assert.equal('requisicion' in b, false);
  });

  it('module OFF: lean rows never expose requisicion or stockDescontadoPor', async () => {
    arrange();
    const out = await repuestosService.list({}, {}, T, OFF);
    for (const r of out.data) {
      assert.equal('requisicion' in r, false);
      assert.equal('stockDescontadoPor' in r, false);
    }
    // same for the by-equipo and by-report lists
    for (const out2 of [await repuestosService.listByEquipo('e1', null, {}, T, OFF), await repuestosService.listByReport('rep', {}, T, OFF)]) {
      for (const r of out2.data) assert.equal('requisicion' in r, false);
    }
    const on = await repuestosService.listByEquipo('e1', null, {}, T, ON);
    assert.ok(on.data[0].requisicion);
  });

  it('requisicionEstado filter: sin / con / a disponibilidad (module ON)', async () => {
    arrange();
    await repuestosService.list({ requisicionEstado: 'sin' }, {}, T, ON);
    assert.deepEqual(query['requisicion.requisicionId'], { $exists: false });
    await repuestosService.list({ requisicionEstado: 'con' }, {}, T, ON);
    assert.deepEqual(query['requisicion.requisicionId'], { $exists: true });
    await repuestosService.list({ requisicionEstado: 'En_Abastecimiento' }, {}, T, ON);
    assert.equal(query['requisicion.disponibilidad'], 'En_Abastecimiento');
    assert.equal(query.tenantId, T);
    assert.equal('requisicionEstado' in query, false, 'the filter name never reaches Mongo');
  });

  it('requisicionEstado is ignored when the module is off', async () => {
    arrange();
    await repuestosService.list({ requisicionEstado: 'con' }, {}, T, OFF);
    assert.equal(Object.keys(query).some((k) => k.startsWith('requisicion')), false);
  });

  it('getById: a linked solicitud shows the summary only with the module on', async () => {
    const doc = new Repuestos({ tenantId: T, nombre: 'x', Cantidad: '1', requisicion: link('Recibida'), stockDescontadoPor: 'requisicion' });
    stub(Repuestos, 'findOne', async () => doc);
    const on = await repuestosService.getById('r1', T, ON);
    assert.equal(on.requisicion.disponibilidad, 'Recibida');
    assert.equal('stockDescontadoPor' in on, false);
    const off = await repuestosService.getById('r1', T, OFF);
    assert.equal('requisicion' in off, false);
    assert.equal('stockDescontadoPor' in off, false);
    // an unlinked document is returned as it always was
    const plain = new Repuestos({ tenantId: T, nombre: 'y', Cantidad: '1' });
    stub(Repuestos, 'findOne', async () => plain);
    assert.equal(await repuestosService.getById('r2', T, ON), plain);
  });

  it('presentRepuesto handles documents, lean rows and null', () => {
    assert.equal(presentRepuesto(null, true), null);
    const lean = { _id: 'x', requisicion: link('Disponible'), stockDescontadoPor: 'requisicion' };
    assert.ok(presentRepuesto(lean, true).requisicion);
    assert.equal('requisicion' in presentRepuesto(lean, false), false);
    assert.ok(lean.requisicion, 'the input is not mutated');
    assert.equal('requisicion' in presentRepuesto({ _id: 'x', requisicion: {} }, true), false, 'an empty link is not a link');
  });
});

// ------------------------------------------------------------------------------------------------ conversion rules

describe('repuestoRequisicionService: conversion rules', () => {
  it('parseCantidad: plain positive numbers, default 1 otherwise', () => {
    assert.deepEqual(parseCantidad('3'), { value: 3, defaulted: false });
    assert.deepEqual(parseCantidad(' 2.5 '), { value: 2.5, defaulted: false });
    assert.deepEqual(parseCantidad('2,5'), { value: 2.5, defaulted: false });
    for (const bad of ['dos', '', '0', '-1', '3 und', 'abc1', null, undefined, '1e3', 'NaN']) {
      assert.deepEqual(parseCantidad(bad), { value: 1, defaulted: true }, String(bad));
    }
  });

  it('tenant without the module: 403 CAPABILITY_DISABLED before anything else', async () => {
    let reads = 0;
    stub(Repuestos, 'find', () => { reads += 1; return { lean: async () => [] }; });
    await assert.rejects(
      () => repuestoRequisicionService.createFromSolicitudes(T, { userId: 'u' }, { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID }, { usesRequisiciones: false }),
      (e) => e.statusCode === 403 && e.code === 'CAPABILITY_DISABLED',
    );
    // no capabilities in the call: read from the database (unknown tenant -> everything off)
    stub(Tenant, 'findOne', () => ({ lean: async () => null }));
    await assert.rejects(
      () => repuestoRequisicionService.createFromSolicitudes(T, { userId: 'u' }, { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID }, undefined),
      (e) => e.code === 'CAPABILITY_DISABLED',
    );
    assert.equal(reads, 0);
  });

  it('security M6: stays 403 CAPABILITY_DISABLED with ENFORCE_TENANT_CAPABILITIES off or warn (raw capability)', async () => {
    stub(Repuestos, 'find', () => { throw new Error('must not read'); });
    for (const mode of ['off', 'warn']) {
      process.env.ENFORCE_TENANT_CAPABILITIES = mode;
      await assert.rejects(
        () => repuestoRequisicionService.createFromSolicitudes(T, { userId: 'u' }, { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID }, OFF),
        (e) => e.statusCode === 403 && e.code === 'CAPABILITY_DISABLED',
        mode,
      );
    }
  });

  it('create-and-send without a justification is refused up front (no draft is left behind)', async () => {
    let reads = 0;
    stub(Repuestos, 'find', () => { reads += 1; return { lean: async () => [] }; });
    await assert.rejects(
      () => repuestoRequisicionService.createFromSolicitudes(T, { userId: 'u' }, { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID, enviar: true }, ON),
      (e) => e.statusCode === 400 && e.code === 'JUSTIFICACION_REQUERIDA',
    );
    assert.equal(reads, 0);
  });

  it('a line override for a solicitud outside the selection is a 400', async () => {
    await assert.rejects(
      () => repuestoRequisicionService.createFromSolicitudes(T, { userId: 'u' }, { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID, lineas: [{ repuestoId: '507f1f77bcf86cd799439099', cantidad: 1 }] }, ON),
      (e) => e.statusCode === 400 && e.code === 'LINEA_FUERA_DE_SELECCION',
    );
  });

  describe('eligibility (_loadEligible)', () => {
    const a = oid();
    const b = oid();
    const c = oid();
    function arrange(rows) {
      stub(Repuestos, 'find', (filter) => ({ lean: async () => rows.filter((r) => r.isDeleted !== true).filter((r) => sift(filter)(r)) }));
    }
    it('foreign-tenant or missing solicitudes -> 404 SOLICITUD_NOT_FOUND (a foreign id is indistinguishable from a missing one)', async () => {
      arrange([{ _id: a, tenantId: T }, { _id: b, tenantId: 'other' }]);
      await assert.rejects(
        () => repuestoRequisicionService._loadEligible(T, [String(a), String(b), String(c)]),
        (e) => e.statusCode === 404 && e.code === 'SOLICITUD_NOT_FOUND' && JSON.stringify(e.details.ids) === JSON.stringify([String(b), String(c)]),
      );
    });
    it('not in Solicitado -> 400 SOLICITUD_NO_ELEGIBLE with the ids', async () => {
      arrange([{ _id: a, tenantId: T, EstadoSolicitud: 'En Proceso' }, { _id: b, tenantId: T, EstadoSolicitud: 'Instalado' }, { _id: c, tenantId: T }]);
      await assert.rejects(
        () => repuestoRequisicionService._loadEligible(T, [String(a), String(b), String(c)]),
        (e) => e.statusCode === 400 && e.code === 'SOLICITUD_NO_ELEGIBLE' && e.details.ids.length === 2,
      );
    });
    it('already linked -> 409 SOLICITUD_YA_VINCULADA with the linked ids only', async () => {
      arrange([{ _id: a, tenantId: T, EstadoSolicitud: 'Solicitado', requisicion: link('En_Requisicion') }, { _id: b, tenantId: T, EstadoSolicitud: 'Solicitado' }]);
      await assert.rejects(
        () => repuestoRequisicionService._loadEligible(T, [String(a), String(b)]),
        (e) => e.statusCode === 409 && e.code === 'SOLICITUD_YA_VINCULADA' && JSON.stringify(e.details.ids) === JSON.stringify([String(a)]),
      );
    });
    it('a missing EstadoSolicitud counts as Solicitado; the result keeps the requested order', async () => {
      arrange([{ _id: a, tenantId: T }, { _id: b, tenantId: T, EstadoSolicitud: 'Solicitado' }]);
      const out = await repuestoRequisicionService._loadEligible(T, [String(b), String(a)]);
      assert.deepEqual(out.map((r) => String(r._id)), [String(b), String(a)]);
    });
  });

  describe('line building (_buildLineas)', () => {
    const itemId = oid();
    const equipoId = oid();
    const mk = (over = {}) => ({ _id: oid(), tenantId: T, nombre: 'Sensor SpO2', Cantidad: '2', EquipoId: equipoId, EstadoSolicitud: 'Solicitado', ...over });
    function arrange({ items = [], stockSeen } = {}) {
      stub(EquipoItem, 'find', () => ({ select: () => ({ lean: async () => [{ _id: equipoId, item: 'Monitor', Marca: 'Mindray', Modelo: 'BeneVision', Serie: 'SN1' }] }) }));
      stub(InventarioRepuesto, 'find', (f) => { if (stockSeen) stockSeen.filter = f; return { select: () => ({ lean: async () => items }) }; });
    }

    it('quantity parsed from the text, price from PrecioRepuesto, description with the equipment, origin on the line', async () => {
      arrange();
      const s = mk({ Cantidad: '4', PrecioRepuesto: 125.5, observacion: 'urgente', ResponsableSolicitud: RESP });
      const { lineas, advertencias } = await repuestoRequisicionService._buildLineas(T, [s], new Map(), false);
      assert.equal(advertencias.length, 0);
      assert.equal(lineas[0].cantidadSolicitada, 4);
      assert.equal(lineas[0].precioEstimado, 125.5);
      assert.equal(lineas[0].descripcion, 'Sensor SpO2 — Monitor Mindray BeneVision S/N SN1');
      assert.equal(lineas[0].origenSolicitudRepuestoId, s._id);
      assert.equal(lineas[0].responsableId, RESP, 'security H2: the responsible is snapshotted on the line');
      assert.equal(lineas[0].especificaciones, 'urgente');
      assert.equal(lineas[0].unidad, 'und');
      assert.equal(lineas[0].inventarioItemId, null);
    });

    it('non-numeric quantity -> 1 plus a warning naming the solicitud', async () => {
      arrange();
      const s = mk({ Cantidad: 'un par' });
      const { lineas, advertencias } = await repuestoRequisicionService._buildLineas(T, [s], new Map(), false);
      assert.equal(lineas[0].cantidadSolicitada, 1);
      assert.equal(advertencias.length, 1);
      assert.equal(advertencias[0].repuestoId, String(s._id));
      assert.equal(advertencias[0].campo, 'cantidad');
      assert.equal(advertencias[0].valorOriginal, 'un par');
    });

    it('an explicit quantity in the request wins and silences the warning', async () => {
      arrange();
      const s = mk({ Cantidad: 'un par' });
      const { lineas, advertencias } = await repuestoRequisicionService._buildLineas(T, [s], new Map([[String(s._id), { cantidad: 3 }]]), false);
      assert.equal(lineas[0].cantidadSolicitada, 3);
      assert.equal(advertencias.length, 0);
    });

    it('price precedence: explicit override (even 0) > PrecioRepuesto > stock item price > 0', async () => {
      arrange({ items: [{ _id: itemId, precio: 80, unidad: 'caja' }] });
      const withItem = (over) => mk({ InventarioItemId: itemId, ...over });
      const run = async (s, o) => (await repuestoRequisicionService._buildLineas(T, [s], new Map(o ? [[String(s._id), o]] : []), true)).lineas[0].precioEstimado;
      assert.equal(await run(withItem({ PrecioRepuesto: 100 }), { precioEstimado: 7 }), 7);
      assert.equal(await run(withItem({ PrecioRepuesto: 100 }), { precioEstimado: 0 }), 0);
      assert.equal(await run(withItem({ PrecioRepuesto: 100 })), 100);
      assert.equal(await run(withItem({ PrecioRepuesto: 0 })), 80);
      arrange();
      assert.equal(await run(mk()), 0);
    });

    it('stock item only with Stock básico; the tenant-scoped lookup ignores items of other tenants', async () => {
      const seen = {};
      arrange({ items: [{ _id: itemId, precio: 80, unidad: 'caja' }], stockSeen: seen });
      const s = mk({ InventarioItemId: itemId });
      const withStock = await repuestoRequisicionService._buildLineas(T, [s], new Map(), true);
      assert.equal(String(withStock.lineas[0].inventarioItemId), String(itemId));
      assert.equal(withStock.lineas[0].unidad, 'caja');
      assert.equal(seen.filter.tenantId, T);
      const free = await repuestoRequisicionService._buildLineas(T, [s], new Map(), false);
      assert.equal(free.lineas[0].inventarioItemId, null);
    });

    it('A2: the same stock item in several solicitudes: EVERY line keeps its inventarioItemId (no free-line fallback)', async () => {
      arrange({ items: [{ _id: itemId, precio: 80, unidad: 'caja' }] });
      const a = mk({ InventarioItemId: itemId });
      const b = mk({ InventarioItemId: itemId });
      const { lineas, advertencias } = await repuestoRequisicionService._buildLineas(T, [a, b], new Map(), true);
      assert.equal(String(lineas[0].inventarioItemId), String(itemId));
      assert.equal(String(lineas[1].inventarioItemId), String(itemId));
      assert.equal(advertencias.filter((w) => w.campo === 'inventarioItemId').length, 0);
      assert.equal(String(lineas[1].origenSolicitudRepuestoId), String(b._id));
    });

    it('a deleted/foreign stock item (not found by the tenant lookup) falls back to a free line', async () => {
      arrange({ items: [] });
      const { lineas } = await repuestoRequisicionService._buildLineas(T, [mk({ InventarioItemId: itemId })], new Map(), true);
      assert.equal(lineas[0].inventarioItemId, null);
    });

    it('description override and the 300-char limit', async () => {
      arrange();
      const s = mk({ nombre: 'x'.repeat(500) });
      const { lineas } = await repuestoRequisicionService._buildLineas(T, [s], new Map(), false);
      assert.ok(lineas[0].descripcion.length <= 300);
      const o = await repuestoRequisicionService._buildLineas(T, [mk()], new Map([[String((s._id)), {}]]), false);
      assert.ok(o.lineas[0].descripcion.startsWith('Sensor SpO2'));
      const s2 = mk();
      const custom = await repuestoRequisicionService._buildLineas(T, [s2], new Map([[String(s2._id), { descripcion: 'Descripción propia' }]]), false);
      assert.equal(custom.lineas[0].descripcion, 'Descripción propia');
    });
  });
});

// ------------------------------------------------------------------------------------------------ DTOs

describe('DTOs', () => {
  const base = { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID };
  const err = (dto, v) => dto.validate(v, { abortEarly: false }).error;

  it('POST /repuestos/requisicion: minimal and complete payloads pass', () => {
    assert.equal(err(createRequisicionFromSolicitudesDto, base), undefined);
    assert.equal(err(createRequisicionFromSolicitudesDto, {
      ...base, titulo: 'T', prioridad: 'Alta', fechaRequerida: '2026-11-30', justificacion: 'Porque sí', enviar: true,
      lineas: [{ repuestoId: OID, cantidad: 2, precioEstimado: 10, descripcion: 'x' }],
    }), undefined);
  });

  it('type and area are required (no implicit defaults)', () => {
    for (const k of ['tipoRequisicionId', 'areaId', 'repuestoIds']) {
      const { [k]: _omit, ...rest } = base;
      assert.ok(err(createRequisicionFromSolicitudesDto, rest)?.details.some((d) => d.path[0] === k), k);
    }
  });

  it('rejects protected / unknown fields, empty or duplicated ids, bad overrides', () => {
    for (const f of ['tenantId', 'estado', 'consecutivo', 'creadaPor', 'solicitanteId', 'aprobacion', 'timeline', 'montoEstimado', 'requisicion', 'stockDescontadoPor']) {
      assert.ok(err(createRequisicionFromSolicitudesDto, { ...base, [f]: 'x' }), f);
    }
    assert.ok(err(createRequisicionFromSolicitudesDto, { ...base, repuestoIds: [] }));
    assert.ok(err(createRequisicionFromSolicitudesDto, { ...base, repuestoIds: [OID, OID] }));
    assert.ok(err(createRequisicionFromSolicitudesDto, { ...base, repuestoIds: ['no-id'] }));
    assert.ok(err(createRequisicionFromSolicitudesDto, { ...base, prioridad: 'Máxima' }));
    for (const bad of [{ repuestoId: OID, cantidad: 0 }, { repuestoId: OID, precioEstimado: -1 }, { cantidad: 1 }, { repuestoId: OID, origenSolicitudRepuestoId: OID }, { repuestoId: OID, inventarioItemId: OID }]) {
      assert.ok(err(createRequisicionFromSolicitudesDto, { ...base, lineas: [bad] }), JSON.stringify(bad));
    }
  });

  const otBase = () => ({
    repuestoIds: [OID], responsableUserIds: [OID], fechaInicio: '2026-11-01T10:00:00.000Z', fechaFin: '2026-11-02T10:00:00.000Z',
  });
  it('ot-from-solicitudes: omitirRequisicion needs a reason', () => {
    assert.equal(err(createOtFromSolicitudesDto, otBase()), undefined);
    assert.equal(err(createOtFromSolicitudesDto, { ...otBase(), omitirRequisicion: false }), undefined);
    assert.equal(err(createOtFromSolicitudesDto, { ...otBase(), omitirRequisicion: true, motivoOmision: 'Urgencia clínica' }), undefined);
    assert.ok(err(createOtFromSolicitudesDto, { ...otBase(), omitirRequisicion: true }));
    assert.ok(err(createOtFromSolicitudesDto, { ...otBase(), omitirRequisicion: true, motivoOmision: '  ' }));
  });

  it('GET /repuestos: requisicionEstado accepts only the contracted values', () => {
    for (const v of ['sin', 'con', 'En_Requisicion', 'En_Aprobacion', 'En_Abastecimiento', 'Recibida', 'Disponible', 'En_Disputa']) {
      assert.equal(err(queryRepuestosDto, { requisicionEstado: v }), undefined, v);
    }
    assert.equal(err(queryRepuestosDto, { requisicionEstado: '' }), undefined);
    assert.ok(err(queryRepuestosDto, { requisicionEstado: 'Inventada' }));
    assert.ok(err(queryRepuestosDto, { requisicionEstado: { $ne: 1 } }));
  });
});

// ------------------------------------------------------------------------------------------------ route + controller

describe('POST /repuestos/requisicion: route guards and controller', () => {
  const route = router.stack.find((l) => l.route && l.route.path === '/requisicion' && l.route.methods.post).route;
  const handlers = route.stack.map((l) => l.handle);
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  /** Runs the guard chain (everything before the controller) and returns the first error. */
  const guards = (req) => {
    for (const h of handlers.slice(0, -1)) {
      let err;
      let called = false;
      h(req, res(), (e) => { err = e; called = true; });
      assert.ok(called, 'middleware must call next');
      if (err) return err;
    }
    return undefined;
  };
  const valid = { repuestoIds: [OID], tipoRequisicionId: OID, areaId: OID };
  const user = (permissions) => ({ userId: 'u', tenantId: T, role: 'user', permissions });

  it('is registered once, behind authenticate, and before the :id routes', () => {
    assert.equal(router.stack[0].name, 'authenticate');
    const paths = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    assert.equal(paths.filter((p) => p === 'post /requisicion').length, 1);
    assert.equal(handlers.at(-1), repuestosController.createRequisicion);
  });

  it('needs requisiciones:create AND repuestos:read', () => {
    assert.equal(guards({ user: user([PERMISSIONS.REQUISICIONES_CREATE]), body: valid })?.statusCode, 403);
    assert.equal(guards({ user: user([PERMISSIONS.REPUESTOS_READ]), body: valid })?.statusCode, 403);
    assert.equal(guards({ user: user([]), body: valid })?.statusCode, 403);
    assert.equal(guards({ user: user([PERMISSIONS.REQUISICIONES_CREATE, PERMISSIONS.REPUESTOS_READ]), body: valid }), undefined);
  });

  it('enviar additionally needs requisiciones:send (also when sent as the string "true")', () => {
    const create = [PERMISSIONS.REQUISICIONES_CREATE, PERMISSIONS.REPUESTOS_READ];
    for (const enviar of [true, 'true', 'TRUE']) {
      assert.equal(guards({ user: user(create), body: { ...valid, enviar } })?.statusCode, 403, String(enviar));
      assert.equal(guards({ user: user([...create, PERMISSIONS.REQUISICIONES_SEND]), body: { ...valid, enviar } }), undefined, String(enviar));
    }
    assert.equal(guards({ user: user(create), body: { ...valid, enviar: false } }), undefined);
  });

  it('rejects an invalid body with 400 and a tenantId in the body', () => {
    const u = user([PERMISSIONS.REQUISICIONES_CREATE, PERMISSIONS.REPUESTOS_READ]);
    assert.equal(guards({ user: u, body: { repuestoIds: [OID] } })?.statusCode, 400);
    assert.equal(guards({ user: u, body: { ...valid, tenantId: 'otro' } })?.statusCode, 400);
  });

  it('the controller takes the tenant from the token chain (never the body) and answers 201 {success, message, data:{requisicion, advertencias}}', async () => {
    let seen;
    stub(repuestoRequisicionService, 'createFromSolicitudes', async (...args) => { seen = args; return { requisicion: { _id: 'q1' }, advertencias: [{ campo: 'cantidad' }] }; });
    const r = res();
    let nextErr;
    await repuestosController.createRequisicion(
      { tenantId: T, tenant: { capabilities: ON }, user: { userId: 'u9', fullName: 'Ana', permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] }, body: valid },
      r,
      (e) => { nextErr = e; },
    );
    assert.equal(nextErr, undefined);
    assert.equal(r.statusCode, 201);
    assert.equal(r.body.success, true);
    assert.deepEqual(r.body.data, { requisicion: { _id: 'q1' }, advertencias: [{ campo: 'cantidad' }] });
    assert.equal(seen[0], T);
    assert.deepEqual(seen[1], { userId: 'u9', name: 'Ana', canManageAll: true });
    assert.deepEqual(seen[3], ON);
  });

  it('service errors reach next()', async () => {
    stub(repuestoRequisicionService, 'createFromSolicitudes', async () => { throw Object.assign(new Error('x'), { statusCode: 409, code: 'SOLICITUD_YA_VINCULADA' }); });
    let nextErr;
    await repuestosController.createRequisicion({ tenantId: T, user: { userId: 'u' }, body: valid }, res(), (e) => { nextErr = e; });
    assert.equal(nextErr.code, 'SOLICITUD_YA_VINCULADA');
  });
});

describe('/repuestos/:id routes: ObjectId param validation (security L11)', () => {
  it('get, put, patch and delete reject a malformed id with 400 before reaching the service', async () => {
    const { paramsRepuestosIdDto } = await import('../src/dtos/paramsRepuestosId.dto.js');
    assert.ok(paramsRepuestosIdDto.validate({ id: 'not-an-id' }).error);
    assert.equal(paramsRepuestosIdDto.validate({ id: OID }).error, undefined);
    for (const [method, controllerFn] of [['get', repuestosController.getById], ['put', repuestosController.update], ['patch', repuestosController.update], ['delete', repuestosController.delete]]) {
      const route = router.stack.find((l) => l.route && l.route.path === '/:id' && l.route.methods[method]).route;
      const handlers = route.stack.map((l) => l.handle);
      assert.equal(handlers.at(-1), controllerFn);
      const validator = handlers.at(-2 - (method === 'put' || method === 'patch' ? 1 : 0));
      let err;
      validator({ params: { id: 'not-an-id' }, body: {}, query: {} }, { }, (e) => { err = e; });
      assert.equal(err?.statusCode, 400, method);
    }
  });
});
