/**
 * requisiciones-datos-por-defecto-tenant, task 2.2: idempotent seed of the tenant defaults (DB-free).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { seedRequisicionDefaults } from '../../src/services/requisicionSeed.service.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { stubModel } from '../helpers/memoryModel.js';

let tipos; let areas; let reglas; let presupuestos; let restore; let savedTenantFindOne;
const NOW = new Date('2026-11-01T12:00:00Z');

beforeEach(() => {
  tipos = []; areas = []; reglas = []; presupuestos = [];
  const rs = [
    stubModel(TipoRequisicion, tipos), stubModel(Area, areas),
    stubModel(ReglaAprobacion, reglas), stubModel(PresupuestoArea, presupuestos),
  ];
  savedTenantFindOne = Tenant.findOne;
  Tenant.findOne = () => ({ lean: async () => null });
  restore = () => { rs.forEach((r) => r()); Tenant.findOne = savedTenantFindOne; };
});
afterEach(() => restore());

describe('seedRequisicionDefaults', () => {
  it('seeds an empty tenant: 8 types, 7 areas, 1 rule, 1 budget, all esSistema', async () => {
    const r = await seedRequisicionDefaults('acme', { now: NOW });
    assert.deepEqual(r, { tipos: 8, areas: 7, regla: 1, presupuesto: 1, adoptados: 0 });
    assert.ok([...tipos, ...areas, ...reglas, ...presupuestos].every((d) => d.esSistema === true && d.tenantId === 'acme'));
    assert.equal(reglas[0].montoHasta, null);
    assert.deepEqual(areas.map((a) => a.jefesIds), areas.map(() => []));
    const admin = areas.find((a) => a.codigo === 'ADMINISTRACION');
    assert.equal(String(presupuestos[0].areaId), String(admin._id));
    assert.equal(presupuestos[0].periodo, '2026');
    assert.equal(presupuestos[0].monto, 10000000);
    assert.equal(presupuestos[0].moneda, 'COP');
  });

  it('a second run changes nothing', async () => {
    await seedRequisicionDefaults('acme', { now: NOW });
    const second = await seedRequisicionDefaults('acme', { now: NOW });
    assert.deepEqual(second, { tipos: 0, areas: 0, regla: 0, presupuesto: 0, adoptados: 0 });
    assert.equal(tipos.length, 8); assert.equal(areas.length, 7);
    assert.equal(reglas.length, 1); assert.equal(presupuestos.length, 1);
  });

  it('adopts E1 data (only esSistema set), leaves GENERAL area and keeps the existing rule', async () => {
    for (const c of ['GENERAL', 'REPUESTO', 'PAPELERIA', 'SERVICIO']) {
      tipos.push({ _id: `t${c}`, tenantId: 'acme', codigo: c, nombre: `custom ${c}`, isDeleted: false });
    }
    areas.push({ _id: 'aG', tenantId: 'acme', codigo: 'GENERAL', nombre: 'General', isDeleted: false });
    reglas.push({ _id: 'r1', tenantId: 'acme', orden: 1, nombre: 'Mia', isDeleted: false });
    const r = await seedRequisicionDefaults('acme', { now: NOW });
    assert.deepEqual(r, { tipos: 4, areas: 7, regla: 0, presupuesto: 1, adoptados: 4 });
    assert.equal(tipos.find((t) => t._id === 'tREPUESTO').esSistema, true);
    assert.equal(tipos.find((t) => t._id === 'tREPUESTO').nombre, 'custom REPUESTO');
    assert.equal(areas.find((a) => a._id === 'aG').esSistema, undefined);
    assert.equal(reglas.length, 1);
    assert.equal(reglas[0].esSistema, undefined);
  });

  it('does not resurrect deleted codes nor create a budget when one exists (even deleted)', async () => {
    tipos.push({ _id: 't0', tenantId: 'acme', codigo: 'GENERAL', isDeleted: true });
    presupuestos.push({ _id: 'p0', tenantId: 'acme', isDeleted: true });
    const r = await seedRequisicionDefaults('acme', { now: NOW });
    assert.equal(r.tipos, 7);
    assert.equal(r.presupuesto, 0);
    assert.equal(tipos.find((t) => t._id === 't0').esSistema, undefined);
  });

  it('skips the budget when ADMINISTRACION was deleted', async () => {
    areas.push({ _id: 'aa', tenantId: 'acme', codigo: 'ADMINISTRACION', isDeleted: true });
    const r = await seedRequisicionDefaults('acme', { now: NOW });
    assert.equal(r.areas, 6);
    assert.equal(r.presupuesto, 0);
  });

  it('dry run writes nothing (not even adoptions) but reports', async () => {
    tipos.push({ _id: 'tx', tenantId: 'acme', codigo: 'GENERAL', nombre: 'General', isDeleted: false });
    const r = await seedRequisicionDefaults('acme', { dryRun: true, now: NOW });
    assert.deepEqual(r, { tipos: 7, areas: 7, regla: 1, presupuesto: 1, adoptados: 1 });
    assert.equal(tipos.length, 1); assert.equal(tipos[0].esSistema, undefined);
    assert.equal(areas.length + reglas.length + presupuestos.length, 0);
  });

  it('is isolated per tenant', async () => {
    await seedRequisicionDefaults('acme', { now: NOW });
    const other = await seedRequisicionDefaults('globex', { now: NOW });
    assert.deepEqual(other, { tipos: 8, areas: 7, regla: 1, presupuesto: 1, adoptados: 0 });
    assert.equal(tipos.length, 16);
  });

  it('a duplicate-key race counts as already existing', async () => {
    const orig = TipoRequisicion.create;
    TipoRequisicion.create = async () => { throw Object.assign(new Error('dup'), { code: 11000 }); };
    try {
      const r = await seedRequisicionDefaults('acme', { now: NOW });
      assert.equal(r.tipos, 0);
      assert.equal(r.areas, 7);
    } finally { TipoRequisicion.create = orig; }
  });

  it('rejects a missing tenant', async () => {
    await assert.rejects(() => seedRequisicionDefaults(''));
  });
});
