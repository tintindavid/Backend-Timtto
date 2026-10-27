/**
 * requisiciones-e1-base-aprobacion, tasks 3.3 and 3.6: approval rules and REGLAS_INCONSISTENTES.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Role } from '../../src/models/role.model.js';
import { User } from '../../src/models/user.model.js';
import { reglaAprobacionService, findReglaConflicts } from '../../src/services/reglaAprobacion.service.js';
import { createReglaAprobacionDto, updateReglaAprobacionDto } from '../../src/dtos/reglaAprobacion.dto.js';
import { Area } from '../../src/models/area.model.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { stubModel } from '../helpers/memoryModel.js';

const hex = (c) => c.repeat(24);
let reglas;
let roles;
let users;
let restore;

beforeEach(() => {
  reglas = [];
  roles = [{ _id: 'role1', tenantId: 'acme', permissions: [PERMISSIONS.REQUISICIONES_APPROVE] }, { _id: 'roleX', tenantId: 'other', permissions: [] }];
  users = [{ _id: 'u1', tenantId: 'acme', roleId: 'role1' }, { _id: 'ux', tenantId: 'other' }];
  const restores = [stubModel(ReglaAprobacion, reglas), stubModel(Role, roles), stubModel(User, users), stubModel(Area, [])];
  restore = () => restores.forEach((r) => r());
});
afterEach(() => restore());

const jefe = { orden: 1, nombre: 'Jefe de área', montoDesde: 0, montoHasta: 5_000_000, aprobadorTipo: 'jefe_area' };
const direccion = { orden: 2, nombre: 'Dirección', montoDesde: 5_000_000, montoHasta: null, aprobadorTipo: 'rol', rolId: 'role1' };

describe('findReglaConflicts (pure)', () => {
  const existing = [{ _id: 'a', orden: 1, montoDesde: 0, montoHasta: 5_000_000 }];

  it('adjacent half-open ranges are consistent (0-5M then 5M+)', () => {
    assert.deepEqual(findReglaConflicts({ orden: 2, montoDesde: 5_000_000, montoHasta: null }, existing), []);
  });

  it('flags an overlap', () => {
    const c = findReglaConflicts({ orden: 2, montoDesde: 4_000_000, montoHasta: 9_000_000 }, existing);
    assert.ok(c.some((x) => x.tipo === 'TRASLAPE' && x.reglaId === 'a'));
  });

  it('a rule with no upper limit overlaps any higher range', () => {
    const c = findReglaConflicts({ orden: 2, montoDesde: 1_000, montoHasta: 2_000 }, [{ _id: 'z', orden: 1, montoDesde: 0, montoHasta: null }]);
    assert.ok(c.some((x) => x.tipo === 'TRASLAPE'));
  });

  it('flags a repeated order and an order that contradicts the amounts', () => {
    assert.ok(findReglaConflicts({ orden: 1, montoDesde: 5_000_000, montoHasta: null }, existing).some((x) => x.tipo === 'ORDEN_DUPLICADO'));
    const swapped = findReglaConflicts({ orden: 0, montoDesde: 5_000_000, montoHasta: null }, existing);
    assert.ok(swapped.some((x) => x.tipo === 'ORDEN_INCONSISTENTE'));
  });

  it('flags montoHasta <= montoDesde', () => {
    assert.ok(findReglaConflicts({ orden: 1, montoDesde: 10, montoHasta: 10 }, []).some((x) => x.tipo === 'RANGO_INVALIDO'));
    assert.ok(findReglaConflicts({ orden: 1, montoDesde: 10, montoHasta: 5 }, []).some((x) => x.tipo === 'RANGO_INVALIDO'));
  });
});

describe('reglaAprobacionService.create', () => {
  it('creates consistent levels for the tenant (jefe de área 0-5M, Dirección 5M+)', async () => {
    const a = await reglaAprobacionService.create('acme', jefe);
    const b = await reglaAprobacionService.create('acme', direccion);
    assert.equal(a.tenantId, 'acme');
    assert.equal(a.rolId, null);
    assert.deepEqual(a.usuariosIds, []);
    assert.equal(b.rolId, 'role1');
    assert.equal(reglas.length, 2);
  });

  it('400 REGLAS_INCONSISTENTES when the range overlaps another active rule (scenario: Regla inconsistente)', async () => {
    await reglaAprobacionService.create('acme', jefe);
    await assert.rejects(
      () => reglaAprobacionService.create('acme', { ...direccion, montoDesde: 4_000_000 }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'REGLAS_INCONSISTENTES');
        assert.ok(err.details.conflicts.some((c) => c.tipo === 'TRASLAPE'));
        return true;
      },
    );
    assert.equal(reglas.length, 1);
  });

  it('only the tenant\'s own rules count, and inactive or deleted rules do not conflict', async () => {
    await reglaAprobacionService.create('globex', jefe);
    await reglaAprobacionService.create('acme', jefe); // same range in another tenant: fine
    reglas[1].activo = false;
    await reglaAprobacionService.create('acme', { ...jefe, nombre: 'Otro' });
    reglas[2].isDeleted = true;
    await reglaAprobacionService.create('acme', { ...jefe, nombre: 'Otro 2' });
  });

  it('an inactive rule is not validated against the others', async () => {
    await reglaAprobacionService.create('acme', jefe);
    await reglaAprobacionService.create('acme', { ...jefe, activo: false });
    assert.equal(reglas.length, 2);
  });

  it('400 when a rol rule has no rol of the tenant (scenario: Tipo rol sin rol)', async () => {
    await assert.rejects(() => reglaAprobacionService.create('acme', { ...direccion, rolId: undefined }), { statusCode: 400, code: 'ROL_INVALIDO' });
    await assert.rejects(() => reglaAprobacionService.create('acme', { ...direccion, rolId: 'roleX' }), { statusCode: 400, code: 'ROL_INVALIDO' });
    assert.equal(reglas.length, 0);
  });

  it('400 when a usuarios rule lists users outside the tenant', async () => {
    const rule = { orden: 1, nombre: 'Comité', montoDesde: 0, aprobadorTipo: 'usuarios' };
    await assert.rejects(() => reglaAprobacionService.create('acme', { ...rule, usuariosIds: ['ux'] }), { statusCode: 400, code: 'USUARIO_INVALIDO' });
    await assert.rejects(() => reglaAprobacionService.create('acme', { ...rule, usuariosIds: [] }), { statusCode: 400, code: 'USUARIO_INVALIDO' });
    const ok = await reglaAprobacionService.create('acme', { ...rule, usuariosIds: ['u1', 'u1'] });
    assert.deepEqual(ok.usuariosIds, ['u1']);
  });

  it('drops approver fields that do not apply to the type', async () => {
    const r = await reglaAprobacionService.create('acme', { ...jefe, rolId: 'role1', usuariosIds: ['u1'] });
    assert.equal(r.rolId, null);
    assert.deepEqual(r.usuariosIds, []);
  });

  it('rounds amounts to 2 decimals', async () => {
    const r = await reglaAprobacionService.create('acme', { ...jefe, montoDesde: 0.005, montoHasta: 100.456 });
    assert.equal(r.montoDesde, 0.01);
    assert.equal(r.montoHasta, 100.46);
  });
});

describe('reglaAprobacionService.update / delete / read', () => {
  it('update re-validates the merged rule against the others', async () => {
    const a = await reglaAprobacionService.create('acme', jefe);
    await reglaAprobacionService.create('acme', direccion);
    await assert.rejects(() => reglaAprobacionService.update('acme', a._id, { montoHasta: 8_000_000 }), { code: 'REGLAS_INCONSISTENTES' });
    const ok = await reglaAprobacionService.update('acme', a._id, { montoHasta: 5_000_000, nombre: 'Jefe' });
    assert.equal(ok.nombre, 'Jefe');
  });

  it('changing the approver type re-checks and cleans the approver fields', async () => {
    const d = await reglaAprobacionService.create('acme', direccion);
    await assert.rejects(() => reglaAprobacionService.update('acme', d._id, { aprobadorTipo: 'usuarios' }), { code: 'USUARIO_INVALIDO' });
    const u = await reglaAprobacionService.update('acme', d._id, { aprobadorTipo: 'usuarios', usuariosIds: ['u1'] });
    assert.equal(u.rolId, null);
    assert.deepEqual(u.usuariosIds, ['u1']);
  });

  it('reactivating a rule that now overlaps is rejected', async () => {
    await reglaAprobacionService.create('acme', jefe);
    const off = await reglaAprobacionService.create('acme', { ...jefe, nombre: 'Viejo', activo: false });
    await assert.rejects(() => reglaAprobacionService.update('acme', off._id, { activo: true }), { code: 'REGLAS_INCONSISTENTES' });
  });

  it('IDOR: a rule of another tenant is a 404 for read, update and delete', async () => {
    const a = await reglaAprobacionService.create('acme', jefe);
    await assert.rejects(() => reglaAprobacionService.getById('globex', a._id), { statusCode: 404, code: 'REGLA_NOT_FOUND' });
    await assert.rejects(() => reglaAprobacionService.update('globex', a._id, { nombre: 'x' }), { statusCode: 404 });
    await assert.rejects(() => reglaAprobacionService.delete('globex', a._id), { statusCode: 404 });
    assert.equal(reglas[0].isDeleted, false);
  });

  it('delete is soft and list is scoped to the tenant and ordered', async () => {
    await reglaAprobacionService.create('acme', direccion);
    const a = await reglaAprobacionService.create('acme', jefe);
    await reglaAprobacionService.create('globex', jefe);
    const res = await reglaAprobacionService.list('acme', {}, { page: 1, limit: 50 });
    assert.deepEqual(res.data.map((r) => r.orden), [1, 2]);
    await reglaAprobacionService.delete('acme', a._id);
    assert.equal(reglas.find((r) => r._id === a._id).isDeleted, true);
  });
});

describe('reglaAprobacion DTOs', () => {
  const ok = { orden: 1, nombre: 'Jefe', montoDesde: 0, aprobadorTipo: 'jefe_area' };

  it('jefe_area takes no approver fields; rol needs rolId; usuarios needs users', () => {
    assert.equal(createReglaAprobacionDto.validate(ok).error, undefined);
    assert.ok(createReglaAprobacionDto.validate({ ...ok, rolId: hex('a') }).error);
    assert.ok(createReglaAprobacionDto.validate({ ...ok, aprobadorTipo: 'rol' }).error);
    assert.equal(createReglaAprobacionDto.validate({ ...ok, aprobadorTipo: 'rol', rolId: hex('a') }).error, undefined);
    assert.ok(createReglaAprobacionDto.validate({ ...ok, aprobadorTipo: 'usuarios' }).error);
    assert.ok(createReglaAprobacionDto.validate({ ...ok, aprobadorTipo: 'usuarios', usuariosIds: [] }).error);
    assert.equal(createReglaAprobacionDto.validate({ ...ok, aprobadorTipo: 'usuarios', usuariosIds: [hex('b')] }).error, undefined);
  });

  it('montoHasta must be greater than montoDesde and amounts non-negative', () => {
    assert.ok(createReglaAprobacionDto.validate({ ...ok, montoDesde: 10, montoHasta: 10 }).error);
    assert.equal(createReglaAprobacionDto.validate({ ...ok, montoDesde: 10, montoHasta: 11 }).error, undefined);
    assert.equal(createReglaAprobacionDto.validate({ ...ok, montoHasta: null }).error, undefined);
    assert.ok(createReglaAprobacionDto.validate({ ...ok, montoDesde: -1 }).error);
  });

  it('rejects unknown fields (tenantId, isDeleted) and an empty update', () => {
    assert.ok(createReglaAprobacionDto.validate({ ...ok, tenantId: 'x' }).error);
    assert.ok(createReglaAprobacionDto.validate({ ...ok, isDeleted: true }).error);
    assert.ok(updateReglaAprobacionDto.validate({}).error);
    assert.equal(updateReglaAprobacionDto.validate({ activo: false }).error, undefined);
  });
});

describe('approver eligibility at configuration time (M2)', () => {
  it('400 APROBADOR_SIN_PERMISO / ROL_SIN_PERMISO_APROBAR when the approvers cannot hold requisiciones:approve', async () => {
    users.push({ _id: 'u2', tenantId: 'acme' }); // no role at all
    roles.push({ _id: 'roleNoApprove', tenantId: 'acme', permissions: [] });
    await assert.rejects(
      () => reglaAprobacionService.create('acme', { orden: 1, nombre: 'C', montoDesde: 0, aprobadorTipo: 'usuarios', usuariosIds: ['u1', 'u2'] }),
      { statusCode: 400, code: 'APROBADOR_SIN_PERMISO' },
    );
    await assert.rejects(
      () => reglaAprobacionService.create('acme', { ...direccion, rolId: 'roleNoApprove' }),
      { statusCode: 400, code: 'ROL_SIN_PERMISO_APROBAR' },
    );
    assert.equal(reglas.length, 0);
  });

  it('422 NIVEL_SIN_APROBADOR_ELEGIBLE when one person would be the only approver of two levels', async () => {
    await reglaAprobacionService.create('acme', { ...direccion, montoHasta: 20_000_000 }); // role1 -> only u1
    await assert.rejects(
      () => reglaAprobacionService.create('acme', { orden: 3, nombre: 'Comité', montoDesde: 20_000_000, aprobadorTipo: 'usuarios', usuariosIds: ['u1'] }),
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
        assert.deepEqual(err.details.niveles.map((n) => n.orden), [2, 3]);
        return true;
      },
    );
    assert.equal(reglas.length, 1);
  });

  it('update with a finite montoHasta works against the merged values; RANGO_INVALIDO is checked there', async () => {
    const a = await reglaAprobacionService.create('acme', jefe);
    const u = await reglaAprobacionService.update('acme', a._id, { montoHasta: 3_000_000 });
    assert.equal(u.montoHasta, 3_000_000);
    await assert.rejects(() => reglaAprobacionService.update('acme', a._id, { montoDesde: 3_000_000 }), { statusCode: 400, code: 'RANGO_INVALIDO' });
    await assert.rejects(() => reglaAprobacionService.update('acme', a._id, { montoHasta: 0, activo: false }), { statusCode: 400, code: 'RANGO_INVALIDO' });
  });

  it('getWarnings flags heads without the permission and levels without approvers', async () => {
    users.push({ _id: 'jefeSinPermiso', tenantId: 'acme' });
    const areaRows = [{ _id: 'area1', tenantId: 'acme', nombre: 'Mtto', activa: true, jefesIds: ['jefeSinPermiso'], isDeleted: false }];
    const restoreArea = stubModel(Area, areaRows);
    try {
      await reglaAprobacionService.create('acme', jefe);
      const warnings = await reglaAprobacionService.getWarnings('acme');
      assert.deepEqual(warnings.map((x) => x.tipo), ['JEFE_SIN_PERMISO_APROBAR']);
      assert.deepEqual(warnings[0].usuarios, ['jefeSinPermiso']);
      assert.equal(typeof warnings[0].mensaje, 'string');
      assert.match(warnings[0].mensaje, /Mtto/);
    } finally {
      restoreArea();
    }
  });

  it('getWarnings objects carry tipo + Spanish mensaje (+ nivelOrden for level warnings)', async () => {
    await reglaAprobacionService.create('acme', { ...direccion, montoHasta: 20_000_000 });
    roles[0].permissions = []; // the role loses the permission after the rule was created
    const warnings = await reglaAprobacionService.getWarnings('acme');
    const w = warnings.find((x) => x.tipo === 'NIVEL_SIN_APROBADORES');
    assert.equal(w.nivelOrden, 2);
    assert.match(w.mensaje, /nivel 2/);
  });

  it('N4: a stale rule (role lost the permission) can still be deactivated or renamed; changing the approver re-validates', async () => {
    const d = await reglaAprobacionService.create('acme', direccion);
    roles[0].permissions = [];
    const renamed = await reglaAprobacionService.update('acme', d._id, { nombre: 'Dirección general' });
    assert.equal(renamed.nombre, 'Dirección general');
    const off = await reglaAprobacionService.update('acme', d._id, { activo: false });
    assert.equal(off.activo, false);
    // Reactivating or changing the role re-runs the approver checks.
    await assert.rejects(() => reglaAprobacionService.update('acme', d._id, { activo: true }), { code: 'ROL_SIN_PERMISO_APROBAR' });
    roles.push({ _id: 'roleNoApprove', tenantId: 'acme', permissions: [] });
    await assert.rejects(() => reglaAprobacionService.update('acme', d._id, { rolId: 'roleNoApprove' }), { code: 'ROL_SIN_PERMISO_APROBAR' });
  });
});
