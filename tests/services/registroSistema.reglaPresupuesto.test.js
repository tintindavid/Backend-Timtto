/** requisiciones-datos-por-defecto-tenant, 3.2: protected default rule and budget (DB-free). */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { Role } from '../../src/models/role.model.js';
import { User } from '../../src/models/user.model.js';
import { Area } from '../../src/models/area.model.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { presupuestoAreaService } from '../../src/services/presupuestoArea.service.js';
import { createReglaAprobacionDto, updateReglaAprobacionDto } from '../../src/dtos/reglaAprobacion.dto.js';
import { createPresupuestoAreaDto, updatePresupuestoAreaDto } from '../../src/dtos/presupuestoArea.dto.js';
import { stubModel } from '../helpers/memoryModel.js';

let reglas; let presupuestos; let restore;
const sistema = { code: 'REGISTRO_SISTEMA', statusCode: 409 };

beforeEach(() => {
  reglas = [{ _id: 'r1', tenantId: 'acme', orden: 1, nombre: 'Jefe de área', montoDesde: 0, montoHasta: null, aprobadorTipo: 'jefe_area', rolId: null, usuariosIds: [], activo: true, esSistema: true }];
  presupuestos = [{ _id: 'p1', tenantId: 'acme', areaId: 'a1', periodo: '2026', monto: 10000000, moneda: 'COP', umbralAlerta: 80, esSistema: true }];
  const rs = [stubModel(ReglaAprobacion, reglas), stubModel(PresupuestoArea, presupuestos), stubModel(Role, []), stubModel(User, []), stubModel(Area, [])];
  restore = () => rs.forEach((r) => r());
});
afterEach(() => restore());

describe('regla del sistema', () => {
  it('cannot be deleted, deactivated or renamed', async () => {
    await assert.rejects(() => reglaAprobacionService.delete('acme', 'r1'), sistema);
    await assert.rejects(() => reglaAprobacionService.update('acme', 'r1', { activo: false }), sistema);
    await assert.rejects(() => reglaAprobacionService.update('acme', 'r1', { nombre: 'Otra' }), sistema);
  });

  it('range can be adjusted and the same name is accepted; esSistema stays', async () => {
    const u = await reglaAprobacionService.update('acme', 'r1', { nombre: 'Jefe de área', montoDesde: 0, montoHasta: 5_000_000, esSistema: false });
    assert.equal(u.montoHasta, 5_000_000);
    assert.equal(reglas[0].esSistema, true);
  });

  it('create ignores esSistema and the DTOs reject it', async () => {
    reglas[0].montoHasta = 5_000_000;
    const c = await reglaAprobacionService.create('acme', { orden: 2, nombre: 'N2', montoDesde: 5_000_000, montoHasta: null, aprobadorTipo: 'jefe_area', esSistema: true });
    assert.equal(c.esSistema, undefined);
    assert.ok(createReglaAprobacionDto.validate({ orden: 1, nombre: 'a', montoDesde: 0, aprobadorTipo: 'jefe_area', esSistema: true }).error);
    assert.ok(updateReglaAprobacionDto.validate({ esSistema: true }).error);
  });
});

describe('presupuesto del sistema', () => {
  it('cannot be deleted nor change area/period (same values accepted)', async () => {
    await assert.rejects(() => presupuestoAreaService.delete('acme', 'p1'), sistema);
    await assert.rejects(() => presupuestoAreaService.update('acme', 'p1', { periodo: '2027' }), sistema);
    await assert.rejects(() => presupuestoAreaService.update('acme', 'p1', { areaId: 'a2' }), sistema);
    const u = await presupuestoAreaService.update('acme', 'p1', { areaId: 'a1', periodo: '2026', monto: 5, umbralAlerta: 70 });
    assert.equal(u.monto, 5);
    assert.equal(u.umbralAlerta, 70);
  });

  it('esSistema is not writable and other tenants get 404', async () => {
    await presupuestoAreaService.update('acme', 'p1', { monto: 7, esSistema: false });
    assert.equal(presupuestos[0].esSistema, true);
    await assert.rejects(() => presupuestoAreaService.delete('globex', 'p1'), { statusCode: 404 });
    assert.ok(createPresupuestoAreaDto.validate({ areaId: 'a'.repeat(24), periodo: '2026', monto: 1, esSistema: true }).error);
    assert.ok(updatePresupuestoAreaDto.validate({ esSistema: true }).error);
  });
});
