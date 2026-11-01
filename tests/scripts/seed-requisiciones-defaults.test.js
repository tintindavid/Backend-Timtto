/** requisiciones-datos-por-defecto-tenant, 4.4: seed script (DB-free). */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { seedAllRequisicionDefaults } from '../../scripts/2026-10-25-seed-requisiciones-defaults.js';
import { stubModel } from '../helpers/memoryModel.js';

let savedTenantFindOne; let tipos; let areas; let reglas; let presupuestos; let restores; let savedFind; let queries; let originalLog;

beforeEach(() => {
  tipos = []; areas = []; reglas = []; presupuestos = []; queries = [];
  restores = [stubModel(TipoRequisicion, tipos), stubModel(Area, areas), stubModel(ReglaAprobacion, reglas), stubModel(PresupuestoArea, presupuestos)];
  savedFind = Tenant.find;
  savedTenantFindOne = Tenant.findOne;
  Tenant.findOne = () => ({ lean: async () => null });
  Tenant.find = (filter) => {
    queries.push(filter);
    const rows = filter.tenantId ? [{ tenantId: filter.tenantId }] : [{ tenantId: 'acme' }, { tenantId: 'globex' }];
    const q = { select: () => q, lean: async () => rows };
    return q;
  };
  originalLog = console.log;
  console.log = () => {};
});
afterEach(() => { restores.forEach((r) => r()); Tenant.find = savedFind; Tenant.findOne = savedTenantFindOne; console.log = originalLog; });

describe('seedAllRequisicionDefaults', () => {
  it('seeds every tenant with the module and reports the totals', async () => {
    const t = await seedAllRequisicionDefaults({});
    assert.deepEqual(queries[0], { 'capabilities.usesRequisiciones': true });
    assert.deepEqual(t, { tenants: 2, tipos: 16, areas: 14, reglas: 2, presupuestos: 2, adoptados: 0, dryRun: false });
  });

  it('a second run creates nothing and adopts E1 data', async () => {
    tipos.push({ _id: 'x', tenantId: 'acme', codigo: 'GENERAL', nombre: 'General', isDeleted: false });
    await seedAllRequisicionDefaults({ tenantId: 'acme' });
    assert.deepEqual(queries[0], { tenantId: 'acme' });
    assert.equal(tipos.find((x) => x._id === 'x').esSistema, true);
    const again = await seedAllRequisicionDefaults({ tenantId: 'acme' });
    assert.deepEqual(again, { tenants: 1, tipos: 0, areas: 0, reglas: 0, presupuestos: 0, adoptados: 0, dryRun: false });
  });

  it('--dry-run writes nothing', async () => {
    tipos.push({ _id: 'x', tenantId: 'acme', codigo: 'GENERAL', nombre: 'General', isDeleted: false });
    const t = await seedAllRequisicionDefaults({ dryRun: true });
    assert.equal(t.dryRun, true);
    assert.equal(t.adoptados, 1);
    assert.equal(tipos.length, 1);
    assert.equal(tipos[0].esSistema, undefined);
    assert.equal(areas.length + reglas.length + presupuestos.length, 0);
  });
});
