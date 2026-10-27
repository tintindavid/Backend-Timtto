/**
 * requisiciones-e1-base-aprobacion, tasks 4.1 / 4.5 / 4.6 / 4.7: DTOs, route table, controller envelope and the
 * non-regression guarantees with the module off. Project convention: router stack inspection + fake req/res.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import router from '../../src/routes/requisicion.routes.js';
import { requisicionController } from '../../src/controllers/requisicion.controller.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionApprovalService } from '../../src/services/requisicionApproval.service.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { enforceTenantCapabilities } from '../../src/middlewares/enforceTenantCapabilities.middleware.js';
import {
  createRequisicionDto, updateRequisicionDto, enviarRequisicionDto, cancelarRequisicionDto, reasignarAprobadoresDto,
  cambiarEstadoRequisicionDto, aprobarRequisicionDto, rechazarRequisicionDto, queryRequisicionDto,
} from '../../src/dtos/requisicion.dto.js';
import { createRepuestosDto } from '../../src/dtos/createRepuestos.dto.js';
import { updateRepuestosDto } from '../../src/dtos/updateRepuestos.dto.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';

const oid = '507f1f77bcf86cd799439011';
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const run = (mw, req) => { let err; mw(req, res(), (e) => { err = e; }); return err; };
const linea = { descripcion: 'Guantes', unidad: 'caja', cantidadSolicitada: 2, precioEstimado: 10 };
const base = { titulo: 'T', tipoRequisicionId: oid, areaId: oid, lineas: [linea] };

describe('route table', () => {
  const routes = router.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], route: l.route }));
  it('exposes exactly the contracted endpoints, authenticated first and guarded', () => {
    assert.equal(router.stack[0].name, 'authenticate');
    const got = routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    assert.deepEqual(got, [
      'DELETE /:id', 'GET /', 'GET /:id', 'PATCH /:id', 'PATCH /:id/estado', 'POST /',
      'POST /:id/aprobacion/aprobar', 'POST /:id/aprobacion/reasignar', 'POST /:id/aprobacion/rechazar', 'POST /:id/cancelar', 'POST /:id/enviar',
    ].sort());
    for (const r of routes) assert.ok(r.route.stack.length >= 3, `${r.method} ${r.path}`);
  });

  it('permissions: each guard denies a user with only an unrelated permission', () => {
    const user = { userId: 'u', tenantId: 'acme', role: 'user', permissions: [PERMISSIONS.AREAS_READ] };
    for (const r of routes) assert.equal(run(r.route.stack[0].handle, { user })?.statusCode, 403, `${r.method} ${r.path}`);
    const approve = routes.find((r) => r.path === '/:id/aprobacion/aprobar');
    assert.equal(run(approve.route.stack[0].handle, { user: { ...user, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] } }), undefined);
    const create = routes.find((r) => r.method === 'post' && r.path === '/');
    assert.equal(run(create.route.stack[0].handle, { user: { ...user, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] } })?.statusCode, 403);
    assert.equal(run(authorize(PERMISSIONS.REQUISICIONES_CREATE), {})?.statusCode, 401);
  });
});

describe('DTOs: strict allowlists, protected fields -> 400', () => {
  const protectedFields = ['tenantId', 'consecutivo', 'estado', 'creadaPor', 'montoEstimado', 'aprobacion', 'timeline', 'abastecimiento', 'isDeleted', 'moneda', 'cantidadSurtida'];
  it('create/update reject every protected field and line-level protected fields', () => {
    assert.equal(run(validate(createRequisicionDto), { body: base }), undefined);
    for (const f of protectedFields) {
      assert.equal(run(validate(createRequisicionDto), { body: { ...base, [f]: 'x' } })?.statusCode, 400, `create ${f}`);
      assert.equal(run(validate(updateRequisicionDto), { body: { titulo: 'x', [f]: 'x' } })?.statusCode, 400, `update ${f}`);
    }
    for (const f of ['snapshot', 'cantidadSurtida', 'cantidadComprada', 'cantidadRecibida', 'estadoLinea']) {
      assert.equal(run(validate(createRequisicionDto), { body: { ...base, lineas: [{ ...linea, [f]: 1 }] } })?.statusCode, 400, `linea ${f}`);
    }
  });
  it('lines: 1..100, quantity > 0, free text needs description/unit', () => {
    assert.equal(run(validate(createRequisicionDto), { body: { ...base, lineas: [] } })?.statusCode, 400);
    assert.equal(run(validate(createRequisicionDto), { body: { ...base, lineas: [{ ...linea, cantidadSolicitada: 0 }] } })?.statusCode, 400);
    assert.equal(run(validate(createRequisicionDto), { body: { ...base, lineas: [{ cantidadSolicitada: 1 }] } })?.statusCode, 400);
    assert.equal(run(validate(createRequisicionDto), { body: { ...base, lineas: [{ inventarioItemId: oid, cantidadSolicitada: 1 }] } }), undefined);
    assert.equal(run(validate(createRequisicionDto), { body: { ...base, lineas: Array(101).fill(linea) } })?.statusCode, 400);
  });
  it('action payloads', () => {
    assert.equal(run(validate(updateRequisicionDto), { body: {} })?.statusCode, 400);
    assert.equal(run(validate(enviarRequisicionDto), { body: {} }), undefined);
    assert.equal(run(validate(enviarRequisicionDto), { body: { estado: 'Aprobada' } })?.statusCode, 400);
    assert.equal(run(validate(cancelarRequisicionDto), { body: {} })?.statusCode, 400);
    assert.equal(run(validate(cancelarRequisicionDto), { body: { motivo: 'm' } }), undefined);
    assert.equal(run(validate(cambiarEstadoRequisicionDto), { body: { estado: 'Aprobada' } })?.statusCode, 400);
    assert.equal(run(validate(cambiarEstadoRequisicionDto), { body: { estado: 'Borrador', timeline: [] } })?.statusCode, 400);
    assert.equal(run(validate(cambiarEstadoRequisicionDto), { body: { estado: 'Borrador' } }), undefined);
    assert.equal(run(validate(aprobarRequisicionDto), { body: {} })?.statusCode, 400, 'version is required');
    assert.equal(run(validate(aprobarRequisicionDto), { body: { version: 1 } }), undefined);
    assert.equal(run(validate(aprobarRequisicionDto), { body: { version: 0 } })?.statusCode, 400);
    assert.equal(run(validate(rechazarRequisicionDto), { body: { version: 1 } })?.statusCode, 400);
    assert.equal(run(validate(rechazarRequisicionDto), { body: { observacion: 'no' } })?.statusCode, 400, 'version is required');
    assert.equal(run(validate(rechazarRequisicionDto), { body: { version: 2, observacion: 'no' } }), undefined);
    assert.equal(run(validate(reasignarAprobadoresDto), { body: { nivelOrden: 1, aprobadorIds: [oid] } }), undefined);
    assert.equal(run(validate(reasignarAprobadoresDto), { body: { nivelOrden: 1, aprobadorIds: [] } })?.statusCode, 400);
    assert.equal(run(validate(reasignarAprobadoresDto), { body: { nivelOrden: 1, aprobadorIds: [oid], tenantId: 'x' } })?.statusCode, 400);
  });
  it('list query contract: the exact query the frontend sends (incl. sortBy / order) passes the DTO', () => {
    const fe = {
      page: '1', limit: '10', search: 'REQ', estado: 'Aprobada', areaId: oid, tipoRequisicionId: oid,
      fechaDesde: '2026-01-01', fechaHasta: '2026-12-31', vista: 'por-aprobar', sortBy: 'createdAt', order: 'desc',
    };
    const req = { query: fe };
    assert.equal(run(validate(queryRequisicionDto, 'query'), req), undefined);
    assert.equal(req.query.sortBy, 'createdAt');
    assert.equal(req.query.order, 'desc');
    for (const sortBy of ['createdAt', 'consecutivo', 'montoEstimado', 'estado', 'titulo']) {
      for (const order of ['asc', 'desc']) {
        assert.equal(run(validate(queryRequisicionDto, 'query'), { query: { ...fe, sortBy, order } }), undefined, `${sortBy} ${order}`);
      }
    }
    const defaults = { query: {} };
    assert.equal(run(validate(queryRequisicionDto, 'query'), defaults), undefined);
    assert.equal(defaults.query.sortBy, 'createdAt');
    assert.equal(defaults.query.order, 'desc');
    for (const bad of [{ sortBy: 'isDeleted' }, { sortBy: 'tenantId' }, { order: 'up' }, { sortBy: '$where' }]) {
      assert.equal(run(validate(queryRequisicionDto, 'query'), { query: bad })?.statusCode, 400, JSON.stringify(bad));
    }
  });
  it('list query', () => {
    const ok = { page: '2', limit: '5', estado: 'Aprobada', areaId: oid, fechaDesde: '2026-01-01', vista: 'mias', search: 'REQ' };
    const req = { query: ok };
    assert.equal(run(validate(queryRequisicionDto, 'query'), req), undefined);
    assert.equal(req.query.page, 2);
    for (const bad of [{ vista: 'todas' }, { estado: 'X' }, { fechaDesde: 'ayer' }, { tenantId: 'o' }]) {
      assert.equal(run(validate(queryRequisicionDto, 'query'), { query: bad })?.statusCode, 400);
    }
  });
});

describe('controller: envelope and tenant binding', () => {
  const saved = {};
  afterEach(() => { Object.assign(requisicionService, saved.svc || {}); Object.assign(requisicionApprovalService, saved.appr || {}); });

  it('create -> 201 envelope; tenant from req.tenantId, creator from the token', async () => {
    saved.svc = { create: requisicionService.create };
    let cap;
    requisicionService.create = async (...args) => { cap = args; return { _id: 'r1' }; };
    const out = res();
    await requisicionController.create({ tenantId: 'acme', user: { userId: 'u1' }, body: base, tenant: { capabilities: { x: 1 } } }, out, (e) => { throw e; });
    assert.equal(out.statusCode, 201);
    assert.equal(out.body.success, true);
    assert.equal(cap[0], 'acme');
    assert.equal(cap[1], 'u1');
  });

  it('errors go to next(err); approve/reject bind the actor', async () => {
    saved.appr = { approve: requisicionApprovalService.approve, reject: requisicionApprovalService.reject };
    let actor;
    requisicionApprovalService.approve = async (t, id, a) => { actor = a; return { _id: id }; };
    requisicionApprovalService.reject = async () => { throw new Error('boom'); };
    await requisicionController.aprobar({ tenantId: 'acme', params: { id: oid }, user: { userId: 'u1', fullName: 'Ana' }, body: {} }, res(), () => {});
    assert.deepEqual(actor, { userId: 'u1', name: 'Ana', canManageAll: false });
    let nextErr;
    await requisicionController.rechazar({ tenantId: 'acme', params: { id: oid }, user: { userId: 'u1' }, body: {} }, res(), (e) => { nextErr = e; });
    assert.equal(nextErr.message, 'boom');
  });
});

describe('non-regression with the module off (4.7)', () => {
  const gate = (path, capabilities) => {
    delete process.env.ENFORCE_TENANT_CAPABILITIES;
    let err;
    enforceTenantCapabilities({ user: { userId: 'u', role: 'admin' }, method: 'GET', path, tenant: { tenantId: 't', capabilities } }, {}, (e) => { err = e; });
    return err;
  };
  it('/requisiciones is blocked while Repuestos / OT routes behave as before', () => {
    const caps = { executesServices: true, usesInventoryBasic: true };
    assert.equal(gate('/api/v1/requisiciones', caps)?.code, 'CAPABILITY_DISABLED');
    assert.equal(gate('/api/v1/repuestos', caps), undefined);
    assert.equal(gate('/api/v1/ots', caps), undefined);
  });
  it('Repuestos API never accepts or exposes `requisicion`', () => {
    const req = { requisicionId: oid, estado: 'En_Requisicion' };
    assert.equal(createRepuestosDto.validate({ requisicion: req }, { abortEarly: false }).error?.details.some((d) => d.path[0] === 'requisicion'), true);
    assert.equal(updateRepuestosDto.validate({ requisicion: req }, { abortEarly: false }).error?.details.some((d) => d.path[0] === 'requisicion'), true);
    const doc = new Repuestos({ tenantId: 'acme', requisicion: req, stockDescontadoPor: 'requisicion' });
    assert.equal('requisicion' in doc.toJSON(), false);
  });
  it('legacy services do not reference the requisitions module', () => {
    for (const f of ['repuestos.service.js', 'ot.service.js', 'repuestotrazabilidad.service.js']) {
      const src = readFileSync(new URL(`../../src/services/${f}`, import.meta.url), 'utf8');
      assert.equal(/requisicion/i.test(src), false, f);
    }
  });
});
