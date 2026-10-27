/**
 * requisiciones-e1-base-aprobacion, tasks 3.1 and 3.6: area service (duplicates, tenant heads, AREA_EN_USO,
 * tenant isolation / IDOR). DB-free via the in-memory model stub.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Area } from '../../src/models/area.model.js';
import { User } from '../../src/models/user.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { areaService } from '../../src/services/area.service.js';
import { createAreaDto, updateAreaDto, queryAreaDto } from '../../src/dtos/area.dto.js';
import { stubModel } from '../helpers/memoryModel.js';

const hex = (c) => c.repeat(24);
let areas;
let users;
let requisiciones;
let presupuestos;
let restore;

beforeEach(() => {
  areas = [];
  users = [{ _id: 'u1', tenantId: 'acme' }, { _id: 'u2', tenantId: 'acme' }, { _id: 'ux', tenantId: 'other' }];
  requisiciones = [];
  presupuestos = [];
  const restores = [
    stubModel(Area, areas),
    stubModel(User, users),
    stubModel(Requisicion, requisiciones),
    stubModel(PresupuestoArea, presupuestos),
  ];
  restore = () => restores.forEach((r) => r());
});
afterEach(() => restore());

describe('areaService.create', () => {
  it('creates an active area of the tenant with its heads (scenario: Crear área)', async () => {
    const a = await areaService.create('acme', { nombre: 'Mantenimiento', codigo: ' mtto ', jefesIds: ['u1', 'u2'] });
    assert.equal(a.tenantId, 'acme');
    assert.equal(a.codigo, 'MTTO');
    assert.deepEqual(a.jefesIds, ['u1', 'u2']);
    assert.equal(areas.length, 1);
  });

  it('never trusts a tenantId in the body', async () => {
    const a = await areaService.create('acme', { nombre: 'X', codigo: 'X', tenantId: 'evil' });
    assert.equal(a.tenantId, 'acme');
  });

  it('409 on a duplicate code among live areas (scenario: Código duplicado)', async () => {
    await areaService.create('acme', { nombre: 'A', codigo: 'MTTO' });
    await assert.rejects(
      () => areaService.create('acme', { nombre: 'B', codigo: 'mtto' }),
      { statusCode: 409, code: 'DUPLICATE_AREA_CODE' },
    );
  });

  it('409 DUPLICATE_AREA on the same name ignoring case (scenario: Nombre duplicado)', async () => {
    await areaService.create('acme', { nombre: 'Mantenimiento', codigo: 'A' });
    await assert.rejects(
      () => areaService.create('acme', { nombre: 'MANTENIMIENTO', codigo: 'B' }),
      { statusCode: 409, code: 'DUPLICATE_AREA' },
    );
  });

  it('a soft-deleted area frees its code and name', async () => {
    const first = await areaService.create('acme', { nombre: 'Mantenimiento', codigo: 'A' });
    areas.find((x) => x._id === first._id).isDeleted = true;
    const again = await areaService.create('acme', { nombre: 'Mantenimiento', codigo: 'A' });
    assert.notEqual(again._id, first._id);
  });

  it('the same code / name may exist in another tenant', async () => {
    await areaService.create('acme', { nombre: 'Mantenimiento', codigo: 'A' });
    const other = await areaService.create('globex', { nombre: 'Mantenimiento', codigo: 'A' });
    assert.equal(other.tenantId, 'globex');
  });

  it('400 JEFE_INVALIDO when a head belongs to another tenant or does not exist (scenario: Jefe de otro tenant)', async () => {
    await assert.rejects(
      () => areaService.create('acme', { nombre: 'A', codigo: 'A', jefesIds: ['ux'] }),
      { statusCode: 400, code: 'JEFE_INVALIDO' },
    );
    await assert.rejects(
      () => areaService.create('acme', { nombre: 'A', codigo: 'A', jefesIds: ['u1', 'ghost'] }),
      { statusCode: 400, code: 'JEFE_INVALIDO' },
    );
    assert.equal(areas.length, 0);
  });

  it('de-duplicates repeated heads', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A', jefesIds: ['u1', 'u1'] });
    assert.deepEqual(a.jefesIds, ['u1']);
  });
});

describe('areaService read / update (tenant isolation, IDOR)', () => {
  it('getById of another tenant is a 404', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    await assert.rejects(() => areaService.getById('globex', a._id), { statusCode: 404, code: 'AREA_NOT_FOUND' });
    assert.equal((await areaService.getById('acme', a._id))._id, a._id);
  });

  it('update / delete of another tenant is a 404 and changes nothing', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    await assert.rejects(() => areaService.update('globex', a._id, { nombre: 'Hack' }), { statusCode: 404 });
    await assert.rejects(() => areaService.delete('globex', a._id), { statusCode: 404 });
    assert.equal(areas[0].nombre, 'A');
    assert.equal(areas[0].isDeleted, false);
  });

  it('list is scoped to the tenant and paginated', async () => {
    await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    await areaService.create('acme', { nombre: 'B', codigo: 'B' });
    await areaService.create('globex', { nombre: 'C', codigo: 'C' });
    const res = await areaService.list('acme', {}, { page: 1, limit: 1 });
    assert.equal(res.data.length, 1);
    assert.equal(res.pagination.total, 2);
    assert.equal(res.pagination.pages, 2);
    assert.equal(res.pagination.hasNext, true);
    assert.ok(res.data.every((x) => x.tenantId === 'acme'));
  });

  it('update changes allowed fields only; the code never changes and the name is re-checked', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    await areaService.create('acme', { nombre: 'B', codigo: 'B' });
    await assert.rejects(() => areaService.update('acme', a._id, { nombre: 'b' }), { statusCode: 409, code: 'DUPLICATE_AREA' });
    const updated = await areaService.update('acme', a._id, { nombre: 'A2', codigo: 'HACK', activa: false });
    assert.equal(updated.nombre, 'A2');
    assert.equal(updated.activa, false);
    assert.equal(updated.codigo, 'A', 'codigo is immutable');
    // renaming to its own name is not a duplicate
    await areaService.update('acme', a._id, { nombre: 'a2' });
  });

  it('update validates the heads against the tenant', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    await assert.rejects(() => areaService.update('acme', a._id, { jefesIds: ['ux'] }), { code: 'JEFE_INVALIDO' });
  });
});

describe('areaService.assertAreaActiva', () => {
  it('accepts an active area and rejects inactive, unknown or foreign ones with 400 AREA_INVALIDA (scenario: Área inactiva)', async () => {
    // the stub does not apply schema defaults, so `activa` is explicit
    const ok = await areaService.create('acme', { nombre: 'A', codigo: 'A', activa: true });
    const off = await areaService.create('acme', { nombre: 'B', codigo: 'B', activa: false });
    assert.ok(await areaService.assertAreaActiva('acme', ok._id));
    for (const [tenant, id] of [['acme', off._id], ['acme', 'nope'], ['globex', ok._id]]) {
      await assert.rejects(() => areaService.assertAreaActiva(tenant, id), { statusCode: 400, code: 'AREA_INVALIDA' });
    }
  });
});

describe('areaService.delete (scenario: Eliminar área en uso)', () => {
  it('soft-deletes an unused area', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    await areaService.delete('acme', a._id);
    assert.equal(areas[0].isDeleted, true);
    assert.ok(areas[0].deletedAt instanceof Date);
  });

  for (const [label, store, row] of [
    ['users', () => users, { _id: 'u9', tenantId: 'acme' }],
    ['requisitions (even soft-deleted)', () => requisiciones, { _id: 'r1', tenantId: 'acme', isDeleted: true }],
    ['budgets', () => presupuestos, { _id: 'p1', tenantId: 'acme' }],
  ]) {
    it(`409 AREA_EN_USO when referenced by ${label}`, async () => {
      const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
      store().push({ ...row, areaId: a._id });
      await assert.rejects(() => areaService.delete('acme', a._id), (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'AREA_EN_USO');
        return true;
      });
      assert.equal(areas[0].isDeleted, false);
      // only deactivation is allowed
      const off = await areaService.update('acme', a._id, { activa: false });
      assert.equal(off.activa, false);
    });
  }

  it('a reference from another tenant does not block the delete', async () => {
    const a = await areaService.create('acme', { nombre: 'A', codigo: 'A' });
    users.push({ _id: 'u9', tenantId: 'globex', areaId: a._id });
    await areaService.delete('acme', a._id);
    assert.equal(areas[0].isDeleted, true);
  });
});

describe('area DTOs', () => {
  it('create requires nombre and codigo and rejects unknown fields (tenantId included)', () => {
    assert.equal(createAreaDto.validate({ nombre: 'A', codigo: 'A', jefesIds: [hex('a')] }).error, undefined);
    assert.ok(createAreaDto.validate({ nombre: 'A' }).error);
    assert.ok(createAreaDto.validate({ codigo: 'A' }).error);
    assert.ok(createAreaDto.validate({ nombre: 'A', codigo: 'A', tenantId: 'evil' }).error);
    assert.ok(createAreaDto.validate({ nombre: 'A', codigo: 'A', isDeleted: true }).error);
  });

  it('caps heads at 10, requires ObjectIds and rejects repeated ids', () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => String(i).padStart(24, '0'));
    assert.equal(createAreaDto.validate({ nombre: 'A', codigo: 'A', jefesIds: ids(10) }).error, undefined);
    assert.ok(createAreaDto.validate({ nombre: 'A', codigo: 'A', jefesIds: ids(11) }).error);
    assert.ok(createAreaDto.validate({ nombre: 'A', codigo: 'A', jefesIds: ['x'] }).error);
    assert.ok(createAreaDto.validate({ nombre: 'A', codigo: 'A', jefesIds: [hex('a'), hex('a')] }).error);
  });

  it('update forbids the code (immutable), is non-empty and rejects unknown fields', () => {
    assert.ok(updateAreaDto.validate({ codigo: 'B' }).error);
    assert.ok(updateAreaDto.validate({}).error);
    assert.equal(updateAreaDto.validate({ activa: false }).error, undefined);
  });

  it('query coerces page/limit/activa', () => {
    const { value, error } = queryAreaDto.validate({ page: '2', limit: '5', activa: 'false' });
    assert.equal(error, undefined);
    assert.equal(value.page, 2);
    assert.equal(value.activa, false);
    assert.ok(queryAreaDto.validate({ limit: 1000 }).error);
  });
});
