/**
 * requisiciones-e1-base-aprobacion, tasks 3.1 - 3.6: routes of Areas, Tipos, Reglas and Presupuestos.
 * Project convention (no supertest / DB): inspect the router stack, then drive authorize -> validate ->
 * controller with fake req/res, mocking only the service singleton (the DB boundary). The capability gate is
 * exercised through the global guard.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import areaRoutes from '../../src/routes/area.routes.js';
import tipoRoutes from '../../src/routes/tipoRequisicion.routes.js';
import reglaRoutes from '../../src/routes/reglaAprobacion.routes.js';
import presupuestoRoutes from '../../src/routes/presupuestoArea.routes.js';
import { authorize, authorizeAny } from '../../src/middlewares/rbac.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { enforceTenantCapabilities } from '../../src/middlewares/enforceTenantCapabilities.middleware.js';
import { areaController } from '../../src/controllers/area.controller.js';
import { presupuestoAreaController } from '../../src/controllers/presupuestoArea.controller.js';
import { areaService } from '../../src/services/area.service.js';
import { presupuestoService } from '../../src/services/presupuesto.service.js';
import { createAreaDto } from '../../src/dtos/area.dto.js';
import { resumenPresupuestoDto } from '../../src/dtos/presupuestoArea.dto.js';
import { objectIdParamDto } from '../../src/dtos/objectIdParam.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const ROUTERS = { areas: areaRoutes, 'tipos-requisicion': tipoRoutes, 'reglas-aprobacion': reglaRoutes, 'presupuestos-area': presupuestoRoutes };

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function runMiddleware(mw, req) {
  let err;
  mw(req, res(), (e) => { err = e; });
  return err;
}

describe('router structure: every route is authenticated and authorized', () => {
  for (const [name, router] of Object.entries(ROUTERS)) {
    it(`/${name}: authenticate first, then at least authorize + controller on every route`, () => {
      const [first, ...rest] = router.stack;
      assert.equal(first.name, 'authenticate', 'authenticate is the first layer');
      const routes = rest.filter((l) => l.route).map((l) => l.route);
      assert.ok(routes.length >= 6, 'CRUD routes present');
      for (const r of routes) {
        assert.ok(r.stack.length >= 2, `${Object.keys(r.methods)} ${r.path} must have a guard before the controller`);
        // The first handler of each route is the permission guard (a closure returned by authorize / authorizeAny).
        assert.equal(r.stack[0].handle.length, 3, `${r.path} first handler is (req, res, next)`);
      }
      const verbs = routes.flatMap((r) => Object.keys(r.methods));
      for (const v of ['get', 'post', 'put', 'patch', 'delete']) assert.ok(verbs.includes(v), `${name} has ${v}`);
    });
  }

  it('GET /presupuestos-area/resumen is declared before /:id', () => {
    const paths = presupuestoRoutes.stack.filter((l) => l.route).map((l) => l.route.path);
    assert.ok(paths.indexOf('/resumen') !== -1 && paths.indexOf('/resumen') < paths.indexOf('/:id'));
  });
});

describe('authorize / authorizeAny with the new permissions', () => {
  const user = (permissions, role = 'technician') => ({ user: { userId: 'u1', tenantId: 'acme', role, permissions } });

  it('403 without the permission and pass with it', () => {
    assert.equal(runMiddleware(authorize(PERMISSIONS.AREAS_CREATE), user([PERMISSIONS.AREAS_READ]))?.statusCode, 403);
    assert.equal(runMiddleware(authorize(PERMISSIONS.AREAS_CREATE), user([PERMISSIONS.AREAS_CREATE])), undefined);
    assert.equal(runMiddleware(authorize(PERMISSIONS.AREAS_CREATE), {})?.statusCode, 401);
  });

  it('authorizeAny passes with any listed permission (an approver may read the area budget summary)', () => {
    const guard = authorizeAny(PERMISSIONS.BUDGETS_READ, PERMISSIONS.REQUISICIONES_APPROVE);
    assert.equal(runMiddleware(guard, user([PERMISSIONS.REQUISICIONES_APPROVE])), undefined);
    assert.equal(runMiddleware(guard, user([PERMISSIONS.BUDGETS_READ])), undefined);
    const denied = runMiddleware(guard, user([PERMISSIONS.AREAS_READ]));
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.code, 'FORBIDDEN');
    assert.equal(runMiddleware(guard, user([], 'superadmin')), undefined);
    assert.equal(runMiddleware(guard, user(undefined))?.statusCode, 403);
  });
});

describe('capability gate (scenario: Tenant sin capacidad)', () => {
  const gate = (method, path, capabilities, role = 'admin') => {
    delete process.env.ENFORCE_TENANT_CAPABILITIES;
    let err;
    enforceTenantCapabilities({ user: { userId: 'u', role }, method, path, tenant: { tenantId: 't', capabilities } }, {}, (e) => { err = e; });
    return err;
  };

  it('403 CAPABILITY_DISABLED for reads and writes of every module router without usesRequisiciones', () => {
    for (const prefix of ['areas', 'tipos-requisicion', 'reglas-aprobacion', 'presupuestos-area', 'requisiciones']) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const err = gate(method, `/api/v1/${prefix}`, { executesServices: true });
        assert.equal(err?.statusCode, 403, `${method} ${prefix}`);
        assert.equal(err.code, 'CAPABILITY_DISABLED');
        assert.equal(err.details.capability, 'usesRequisiciones');
      }
    }
    assert.equal(gate('GET', '/api/v1/presupuestos-area/resumen', { executesServices: true })?.code, 'CAPABILITY_DISABLED');
  });

  it('passes with the capability on, and the module is independent of the stock flags', () => {
    assert.equal(gate('GET', '/api/v1/areas', { executesServices: true, usesRequisiciones: true }), undefined);
    assert.equal(gate('POST', '/api/v1/reglas-aprobacion', { executesServices: true, usesRequisiciones: true }), undefined);
    assert.equal(gate('GET', '/api/v1/areas', { executesServices: true, usesInventoryBasic: true, usesInventoryAdvanced: true })?.code, 'CAPABILITY_DISABLED');
  });

  it('turning the capability off does not touch the other premium modules', () => {
    assert.equal(gate('GET', '/api/v1/inventario-repuestos', { executesServices: true, usesInventoryBasic: true }), undefined);
  });
});

describe('Areas controller: envelope and tenant binding', () => {
  afterEach(() => {
    delete areaService.create;
    delete areaService.list;
    delete areaService.delete;
  });

  it('POST: validated body, tenant from the token chain (never the body), 201 envelope', async () => {
    let captured;
    areaService.create = async (tenantId, body) => { captured = { tenantId, body }; return { _id: 'a1', tenantId, ...body }; };
    const req = { body: { nombre: 'Mtto', codigo: 'MTTO' }, tenantId: 'acme', user: { userId: 'u1', role: 'admin', permissions: [PERMISSIONS.AREAS_CREATE] } };
    assert.equal(runMiddleware(authorize(PERMISSIONS.AREAS_CREATE), req), undefined);
    assert.equal(runMiddleware(validate(createAreaDto, 'body'), req), undefined);
    const out = res();
    await areaController.create(req, out, (e) => { throw e; });
    assert.equal(out.statusCode, 201);
    assert.equal(out.body.success, true);
    assert.equal(out.body.data.tenantId, 'acme');
    assert.equal(captured.tenantId, 'acme');
  });

  it('a body carrying tenantId is a 400 before the service runs', () => {
    const req = { body: { nombre: 'Mtto', codigo: 'MTTO', tenantId: 'other' } };
    const err = runMiddleware(validate(createAreaDto, 'body'), req);
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'VALIDATION_ERROR');
  });

  it('list returns the pagination block and forwards filters', async () => {
    let args;
    areaService.list = async (tenantId, filters, pagination) => {
      args = { tenantId, filters, pagination };
      return { data: [], pagination: { page: 1, limit: 10, total: 0, pages: 0, hasNext: false, hasPrev: false } };
    };
    const out = res();
    await areaController.list({ tenantId: 'acme', query: { page: 1, limit: 10, sortBy: 'nombre', order: 'asc', activa: true } }, out, (e) => { throw e; });
    assert.deepEqual(args.filters, { activa: true });
    assert.equal(args.tenantId, 'acme');
    assert.equal(out.body.pagination.total, 0);
  });

  it('service errors (AREA_EN_USO) reach the error handler untouched', async () => {
    areaService.delete = async () => { throw new ApiError(409, 'en uso', 'AREA_EN_USO'); };
    let captured;
    await areaController.delete({ tenantId: 'acme', params: { id: 'a'.repeat(24) } }, res(), (e) => { captured = e; });
    assert.equal(captured.statusCode, 409);
    assert.equal(captured.code, 'AREA_EN_USO');
  });

  it('a malformed :id is a 400, not a cast error', () => {
    const err = runMiddleware(validate(objectIdParamDto, 'params'), { params: { id: '123' } });
    assert.equal(err.statusCode, 400);
    assert.equal(runMiddleware(validate(objectIdParamDto, 'params'), { params: { id: 'a'.repeat(24) } }), undefined);
  });
});

describe('Presupuestos resumen controller', () => {
  afterEach(() => { delete presupuestoService.getResumen; });

  it('passes the tenant of the token and the validated query', async () => {
    let args;
    presupuestoService.getResumen = async (tenantId, q) => { args = { tenantId, q }; return { monto: 1 }; };
    const req = { tenantId: 'acme', query: { areaId: 'a'.repeat(24), periodo: '2026-03' } };
    assert.equal(runMiddleware(validate(resumenPresupuestoDto, 'query'), req), undefined);
    const out = res();
    await presupuestoAreaController.resumen(req, out, (e) => { throw e; });
    assert.equal(out.statusCode, 200);
    assert.equal(out.body.data.monto, 1);
    assert.deepEqual(args, { tenantId: 'acme', q: { areaId: 'a'.repeat(24), periodo: '2026-03' } });
  });

  it('rejects an invalid period before the service', () => {
    const err = runMiddleware(validate(resumenPresupuestoDto, 'query'), { query: { areaId: 'a'.repeat(24), periodo: '2026-99' } });
    assert.equal(err.statusCode, 400);
  });
});
