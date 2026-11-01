/**
 * requisiciones-e1-base-aprobacion, tasks 3.2 and 3.6: request types (TIPO_EN_USO, duplicates, tenant isolation)
 * and the idempotent seed of types / area / rule.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { createTipoRequisicionDto, updateTipoRequisicionDto } from '../../src/dtos/tipoRequisicion.dto.js';
import { stubModel } from '../helpers/memoryModel.js';

let tipos;
let requisiciones;
let areas;
let reglas;
let restore;

beforeEach(() => {
  tipos = [];
  requisiciones = [];
  areas = [];
  reglas = [];
  const restores = [
    stubModel(TipoRequisicion, tipos),
    stubModel(Requisicion, requisiciones),
    stubModel(Area, areas),
    stubModel(ReglaAprobacion, reglas),
  ];
  restore = () => restores.forEach((r) => r());
});
afterEach(() => restore());

describe('tipoRequisicionService', () => {
  it('creates a type of the tenant with an upper-cased code', async () => {
    const t = await tipoRequisicionService.create('acme', { nombre: 'Insumos', codigo: 'insumos', tenantId: 'evil' });
    assert.equal(t.tenantId, 'acme');
    assert.equal(t.codigo, 'INSUMOS');
  });

  it('409 on duplicate code or name (ignoring case) inside the tenant, not across tenants', async () => {
    await tipoRequisicionService.create('acme', { nombre: 'Insumos', codigo: 'INS' });
    await assert.rejects(() => tipoRequisicionService.create('acme', { nombre: 'Otro', codigo: 'ins' }), { statusCode: 409, code: 'DUPLICATE_TIPO_CODE' });
    await assert.rejects(() => tipoRequisicionService.create('acme', { nombre: 'INSUMOS', codigo: 'X' }), { statusCode: 409, code: 'DUPLICATE_TIPO' });
    assert.ok(await tipoRequisicionService.create('globex', { nombre: 'Insumos', codigo: 'INS' }));
  });

  it('the code is immutable on update and IDOR on another tenant is a 404', async () => {
    const t = await tipoRequisicionService.create('acme', { nombre: 'Insumos', codigo: 'INS', activo: true });
    const u = await tipoRequisicionService.update('acme', t._id, { nombre: 'Insumos 2', codigo: 'HACK' });
    assert.equal(u.codigo, 'INS');
    assert.equal(u.nombre, 'Insumos 2');
    await assert.rejects(() => tipoRequisicionService.update('globex', t._id, { nombre: 'Hack' }), { statusCode: 404, code: 'TIPO_NOT_FOUND' });
    await assert.rejects(() => tipoRequisicionService.getById('globex', t._id), { statusCode: 404 });
    await assert.rejects(() => tipoRequisicionService.delete('globex', t._id), { statusCode: 404 });
  });

  it('assertTipoActivo: only active types of the tenant (scenario: Tipo inactivo)', async () => {
    const on = await tipoRequisicionService.create('acme', { nombre: 'A', codigo: 'A', activo: true });
    const off = await tipoRequisicionService.create('acme', { nombre: 'B', codigo: 'B', activo: false });
    assert.ok(await tipoRequisicionService.assertTipoActivo('acme', on._id));
    await assert.rejects(() => tipoRequisicionService.assertTipoActivo('acme', off._id), { statusCode: 400, code: 'TIPO_INVALIDO' });
    await assert.rejects(() => tipoRequisicionService.assertTipoActivo('globex', on._id), { statusCode: 400, code: 'TIPO_INVALIDO' });
  });

  it('409 TIPO_EN_USO when a requisition (even a soft-deleted one) references it; deactivating is allowed', async () => {
    const t = await tipoRequisicionService.create('acme', { nombre: 'A', codigo: 'A', activo: true });
    requisiciones.push({ _id: 'r1', tenantId: 'acme', tipoRequisicionId: t._id, isDeleted: true });
    await assert.rejects(() => tipoRequisicionService.delete('acme', t._id), { statusCode: 409, code: 'TIPO_EN_USO' });
    assert.equal(tipos[0].isDeleted, false);
    const off = await tipoRequisicionService.update('acme', t._id, { activo: false });
    assert.equal(off.activo, false);
  });

  it('soft-deletes an unused type', async () => {
    const t = await tipoRequisicionService.create('acme', { nombre: 'A', codigo: 'A' });
    await tipoRequisicionService.delete('acme', t._id);
    assert.equal(tipos[0].isDeleted, true);
    assert.ok(tipos[0].deletedAt instanceof Date);
  });

  it('list is scoped to the tenant', async () => {
    await tipoRequisicionService.create('acme', { nombre: 'A', codigo: 'A' });
    await tipoRequisicionService.create('globex', { nombre: 'B', codigo: 'B' });
    const res = await tipoRequisicionService.list('acme', {}, { page: 1, limit: 10 });
    assert.equal(res.pagination.total, 1);
    assert.equal(res.data[0].tenantId, 'acme');
  });
});
describe('tipoRequisicion DTOs', () => {
  it('create requires nombre and codigo and rejects unknown fields', () => {
    assert.equal(createTipoRequisicionDto.validate({ nombre: 'A', codigo: 'A' }).error, undefined);
    assert.ok(createTipoRequisicionDto.validate({ nombre: 'A' }).error);
    assert.ok(createTipoRequisicionDto.validate({ nombre: 'A', codigo: 'A', tenantId: 'x' }).error);
  });

  it('update forbids the code and an empty body', () => {
    assert.ok(updateTipoRequisicionDto.validate({ codigo: 'B' }).error);
    assert.ok(updateTipoRequisicionDto.validate({}).error);
    assert.equal(updateTipoRequisicionDto.validate({ activo: false }).error, undefined);
  });
});
