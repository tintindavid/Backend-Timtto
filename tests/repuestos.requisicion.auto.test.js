/**
 * requisiciones-hacer-desde-solicitud-auto, group 1 (DB-free): server-fixed type (REPUESTO) and area, resolved BEFORE
 * the solicitudes are claimed. The real flow lives in tests/integration/requisicion.hacerAuto.mongo.integration.test.js.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { repuestoRequisicionService as svc } from '../src/services/repuestoRequisicion.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { User } from '../src/models/user.model.js';
import { TipoRequisicion } from '../src/models/tipoRequisicion.model.js';
import { areaService } from '../src/services/area.service.js';
import { createRequisicionFromSolicitudesDto as dto } from '../src/dtos/createRequisicionFromSolicitudes.dto.js';
import { ApiError } from '../src/utils/apiError.util.js';

const OID = '507f1f77bcf86cd799439011';
const AREA_OWN = '507f1f77bcf86cd7994390a1';
const AREA_BODY = '507f1f77bcf86cd7994390a2';
const TIPO = '507f1f77bcf86cd7994390b1';
const T = 'tenant-a';
const ON = { usesRequisiciones: true };

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
let calls;
let tipoRow;
let userRow;
let activeAreas;
beforeEach(() => {
  process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
  calls = { tipoFilter: null, userFilter: null, claim: 0 };
  tipoRow = { _id: TIPO };
  userRow = { areaId: AREA_OWN };
  activeAreas = [AREA_OWN, AREA_BODY];
  stub(TipoRequisicion, 'findOne', (f) => { calls.tipoFilter = f; return { select: () => ({ lean: async () => tipoRow }) }; });
  stub(User, 'findOne', (f) => { calls.userFilter = f; return { select: () => ({ lean: async () => userRow }) }; });
  stub(areaService, 'assertAreaActiva', async (tenantId, id) => {
    if (!activeAreas.includes(String(id))) throw new ApiError(400, 'x', 'AREA_INVALIDA');
    return { _id: new mongoose.Types.ObjectId(String(id)) };
  });
});
afterEach(() => { while (stubs.length) { const [t, k, v] = stubs.pop(); t[k] = v; } });

describe('_resolveTipoYArea', () => {
  it('fixed type: REPUESTO, active, tenant-filtered', async () => {
    const r = await svc._resolveTipoYArea(T, { userId: 'u' }, undefined);
    assert.equal(r.tipoId, TIPO);
    assert.equal(calls.tipoFilter.tenantId, T);
    assert.equal(calls.tipoFilter.codigo, 'REPUESTO');
    assert.equal(calls.tipoFilter.activo, true);
  });
  it('own area is read from the DB filtered by tenant and wins over the body areaId', async () => {
    const r = await svc._resolveTipoYArea(T, { userId: 'u' }, AREA_BODY);
    assert.equal(r.areaId, AREA_OWN);
    assert.equal(calls.userFilter.tenantId, T);
  });
  it('user without area: the body areaId is used', async () => {
    userRow = {};
    assert.equal((await svc._resolveTipoYArea(T, { userId: 'u' }, AREA_BODY)).areaId, AREA_BODY);
  });
  it('user with an inactive area falls back to the body areaId', async () => {
    activeAreas = [AREA_BODY];
    assert.equal((await svc._resolveTipoYArea(T, { userId: 'u' }, AREA_BODY)).areaId, AREA_BODY);
  });
  it('no own area and no selection -> 400 AREA_REQUERIDA', async () => {
    userRow = {};
    await assert.rejects(() => svc._resolveTipoYArea(T, { userId: 'u' }, undefined), (e) => e.statusCode === 400 && e.code === 'AREA_REQUERIDA');
  });
  it('body areaId that is not an active area of the tenant -> 400 AREA_INVALIDA', async () => {
    userRow = {};
    await assert.rejects(() => svc._resolveTipoYArea(T, { userId: 'u' }, '507f1f77bcf86cd7994390ff'), (e) => e.code === 'AREA_INVALIDA');
  });
  it('tenant without the REPUESTO type -> 409 TIPO_REPUESTO_NO_CONFIGURADO', async () => {
    tipoRow = null;
    await assert.rejects(() => svc._resolveTipoYArea(T, { userId: 'u' }, AREA_OWN), (e) => e.statusCode === 409 && e.code === 'TIPO_REPUESTO_NO_CONFIGURADO');
  });
});

describe('createFromSolicitudes: nothing is claimed when the resolution fails', () => {
  const run = () => {
    stub(svc, '_loadEligible', async () => [{ _id: OID, nombre: 'x' }]);
    stub(svc, '_buildLineas', async () => ({ lineas: [], advertencias: [] }));
    stub(Repuestos, 'updateMany', async () => { calls.claim += 1; return { modifiedCount: 1 }; });
    return svc.createFromSolicitudes(T, { userId: 'u' }, { repuestoIds: [OID] }, ON);
  };
  it('tenant without type', async () => {
    tipoRow = null;
    await assert.rejects(run, (e) => e.code === 'TIPO_REPUESTO_NO_CONFIGURADO');
    assert.equal(calls.claim, 0);
  });
  it('no area', async () => {
    userRow = {};
    await assert.rejects(run, (e) => e.code === 'AREA_REQUERIDA');
    assert.equal(calls.claim, 0);
  });
});

describe('DTO', () => {
  it('rejects tipoRequisicionId and line precioEstimado; areaId optional', () => {
    assert.equal(dto.validate({ repuestoIds: [OID] }).error, undefined);
    assert.ok(dto.validate({ repuestoIds: [OID], tipoRequisicionId: TIPO }).error);
    assert.ok(dto.validate({ repuestoIds: [OID], lineas: [{ repuestoId: OID, precioEstimado: 5 }] }).error);
  });
});
