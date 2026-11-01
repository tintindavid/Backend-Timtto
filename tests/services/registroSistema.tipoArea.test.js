/** requisiciones-datos-por-defecto-tenant, 3.2: protected default types and areas (DB-free). */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { User } from '../../src/models/user.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { areaService } from '../../src/services/area.service.js';
import { createTipoRequisicionDto } from '../../src/dtos/tipoRequisicion.dto.js';
import { createAreaDto, updateAreaDto } from '../../src/dtos/area.dto.js';
import { stubModel } from '../helpers/memoryModel.js';

let tipos; let areas; let users; let restore;
const sistema = { code: 'REGISTRO_SISTEMA', statusCode: 409 };

beforeEach(() => {
  tipos = [{ _id: 't1', tenantId: 'acme', codigo: 'GENERAL', nombre: 'General', activo: true, esSistema: true }];
  areas = [{ _id: 'a1', tenantId: 'acme', codigo: 'COMPRAS', nombre: 'Compras', activa: true, jefesIds: [], esSistema: true }];
  users = [{ _id: 'u1', tenantId: 'acme' }];
  const rs = [
    stubModel(TipoRequisicion, tipos), stubModel(Area, areas), stubModel(User, users),
    stubModel(Requisicion, []), stubModel(PresupuestoArea, []),
  ];
  restore = () => rs.forEach((r) => r());
});
afterEach(() => restore());

describe('tipos del sistema', () => {
  it('cannot be deleted, deactivated or renamed', async () => {
    await assert.rejects(() => tipoRequisicionService.delete('acme', 't1'), sistema);
    await assert.rejects(() => tipoRequisicionService.update('acme', 't1', { activo: false }), sistema);
    await assert.rejects(() => tipoRequisicionService.update('acme', 't1', { nombre: 'Otro' }), sistema);
    assert.equal(tipos[0].activo, true);
    assert.equal(tipos[0].isDeleted, undefined);
  });

  it('the whole object with unchanged values is accepted and esSistema cannot be written', async () => {
    const u = await tipoRequisicionService.update('acme', 't1', { nombre: 'General', activo: true, descripcion: 'x', esSistema: false });
    assert.equal(u.descripcion, 'x');
    assert.equal(tipos[0].esSistema, true);
    const c = await tipoRequisicionService.create('acme', { nombre: 'Nuevo', codigo: 'NUE', esSistema: true });
    assert.equal(c.esSistema, undefined);
  });

  it('non-system types stay editable and the DTO rejects esSistema', async () => {
    tipos.push({ _id: 't2', tenantId: 'acme', codigo: 'X', nombre: 'X', activo: true });
    await tipoRequisicionService.update('acme', 't2', { activo: false, nombre: 'Y' });
    await tipoRequisicionService.delete('acme', 't2');
    assert.ok(createTipoRequisicionDto.validate({ nombre: 'a', codigo: 'A', esSistema: true }).error);
  });

  it('other tenants cannot reach it (404)', async () => {
    await assert.rejects(() => tipoRequisicionService.update('globex', 't1', { descripcion: 'x' }), { statusCode: 404 });
  });
});

describe('areas del sistema', () => {
  it('cannot be deleted, deactivated or renamed', async () => {
    await assert.rejects(() => areaService.delete('acme', 'a1'), sistema);
    await assert.rejects(() => areaService.update('acme', 'a1', { activa: false }), sistema);
    await assert.rejects(() => areaService.update('acme', 'a1', { nombre: 'Otra' }), sistema);
  });

  it('heads can be adjusted and the same name/active re-sent is accepted', async () => {
    const u = await areaService.update('acme', 'a1', { nombre: 'Compras', activa: true, jefesIds: ['u1'] });
    assert.deepEqual(u.jefesIds, ['u1']);
    assert.equal(areas[0].esSistema, true);
  });

  it('esSistema is not writable (service and DTO)', async () => {
    await areaService.update('acme', 'a1', { jefesIds: [], esSistema: false });
    assert.equal(areas[0].esSistema, true);
    const c = await areaService.create('acme', { nombre: 'Nueva', codigo: 'NUE', esSistema: true });
    assert.equal(c.esSistema, undefined);
    assert.ok(createAreaDto.validate({ nombre: 'a', codigo: 'A', esSistema: true }).error);
    assert.ok(updateAreaDto.validate({ esSistema: true }).error);
  });
});
