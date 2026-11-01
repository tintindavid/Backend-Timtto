/**
 * requisiciones-datos-por-defecto-tenant, 7.1 / 7.2 / 7.4: adversarial-review fixes (DB-free).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { logger } from '../../src/config/logger.config.js';
import { seedRequisicionDefaults } from '../../src/services/requisicionSeed.service.js';
import { assertSistemaUpdate, isFalsy } from '../../src/utils/registroSistema.util.js';
import { stubModel } from '../helpers/memoryModel.js';

let tipos; let areas; let reglas; let presupuestos; let restores; let savedFindOne; let savedWarn; let warns; let tenantDoc;
const NOW = new Date('2026-11-01T12:00:00Z');
const dup = () => Object.assign(new Error('E11000 dup'), { code: 11000 });

beforeEach(() => {
  tipos = []; areas = []; reglas = []; presupuestos = []; warns = []; tenantDoc = null;
  restores = [stubModel(TipoRequisicion, tipos), stubModel(Area, areas), stubModel(ReglaAprobacion, reglas), stubModel(PresupuestoArea, presupuestos)];
  savedFindOne = Tenant.findOne;
  Tenant.findOne = () => ({ lean: async () => tenantDoc });
  savedWarn = logger.warn;
  logger.warn = (msg, meta) => warns.push({ msg, meta });
});
afterEach(() => { restores.forEach((r) => r()); Tenant.findOne = savedFindOne; logger.warn = savedWarn; });

describe('7.1 the example rule is atomic', () => {
  it('N concurrent seeds against a unique-index emulation leave exactly one rule and one budget', async () => {
    // Emulates the partial unique indexes: the 2nd insert of a system rule / of the same budget fails with E11000.
    const realRule = ReglaAprobacion.create;
    const realBudget = PresupuestoArea.create;
    const realTipo = TipoRequisicion.create;
    const realArea = Area.create;
    const gate = () => new Promise((r) => setImmediate(r));
    ReglaAprobacion.create = async (d) => { await gate(); if (reglas.some((x) => x.tenantId === d.tenantId && x.esSistema && !x.isDeleted)) throw dup(); return realRule(d); };
    PresupuestoArea.create = async (d) => { await gate(); if (presupuestos.some((x) => x.tenantId === d.tenantId && String(x.areaId) === String(d.areaId) && x.periodo === d.periodo)) throw dup(); return realBudget(d); };
    TipoRequisicion.create = async (d) => { await gate(); if (tipos.some((x) => x.tenantId === d.tenantId && x.codigo === d.codigo)) throw dup(); return realTipo(d); };
    Area.create = async (d) => { await gate(); if (areas.some((x) => x.tenantId === d.tenantId && x.codigo === d.codigo)) throw dup(); return realArea(d); };

    await Promise.all(Array.from({ length: 5 }, () => seedRequisicionDefaults('acme', { now: NOW })));
    assert.equal(reglas.length, 1);
    assert.equal(presupuestos.length, 1);
    assert.equal(tipos.length, 8);
    assert.equal(areas.length, 7);
  });

  it('a duplicate key on the rule counts as already existing (no throw, regla 0)', async () => {
    ReglaAprobacion.create = async () => { throw dup(); };
    const r = await seedRequisicionDefaults('acme', { now: NOW });
    assert.equal(r.regla, 0);
  });

  it('the rule model declares the partial unique index on { tenantId, esSistema }', () => {
    const idx = ReglaAprobacion.schema.indexes().find(([f]) => f.esSistema === 1 && f.tenantId === 1);
    assert.ok(idx);
    assert.equal(idx[1].unique, true);
    assert.deepEqual(idx[1].partialFilterExpression, { esSistema: true, isDeleted: false });
  });
});

describe('7.2 budget currency and warnings', () => {
  it('uses the tenant currency (COP fallback)', async () => {
    tenantDoc = { settings: { currency: 'usd' } };
    await seedRequisicionDefaults('acme', { now: NOW });
    assert.equal(presupuestos[0].moneda, 'USD');
    presupuestos.length = 0; areas.length = 0; reglas.length = 0; tipos.length = 0;
    tenantDoc = null;
    await seedRequisicionDefaults('acme', { now: NOW });
    assert.equal(presupuestos[0].moneda, 'COP');
  });

  it('warns when a default is skipped by a duplicate key (tenantId, codigo)', async () => {
    const real = TipoRequisicion.create;
    TipoRequisicion.create = async (d) => { if (d.codigo === 'INSUMO') throw dup(); return real(d); };
    await seedRequisicionDefaults('acme', { now: NOW });
    const w = warns.find((x) => x.meta?.codigo === 'INSUMO');
    assert.ok(w);
    assert.equal(w.meta.tenantId, 'acme');
  });

  it('warns when ADMINISTRACION is absent/deleted and the budget is skipped', async () => {
    areas.push({ _id: 'aa', tenantId: 'acme', codigo: 'ADMINISTRACION', isDeleted: true });
    const r = await seedRequisicionDefaults('acme', { now: NOW });
    assert.equal(r.presupuesto, 0);
    const w = warns.find((x) => x.meta?.codigo === 'ADMINISTRACION');
    assert.ok(w);
    assert.equal(w.meta.tenantId, 'acme');
  });
});

describe('7.4 rename and deactivation guards', () => {
  const rec = { esSistema: true, nombre: 'Tecnología', activa: true };
  const sistema = { code: 'REGISTRO_SISTEMA', statusCode: 409 };

  it('NFC/NFD forms of the same name and trailing spaces are not a rename', () => {
    assert.doesNotThrow(() => assertSistemaUpdate(rec, { nombre: 'Tecnología' }, { activeField: 'activa' }));
    assert.doesNotThrow(() => assertSistemaUpdate(rec, { nombre: '  Tecnología  ' }, { activeField: 'activa' }));
  });

  it('a case change is a rename', () => {
    assert.throws(() => assertSistemaUpdate(rec, { nombre: 'tecnología' }, { activeField: 'activa' }), sistema);
  });

  it('false / "false" / 0 deactivate; true and undefined do not', () => {
    for (const v of [false, 'false', 0, '0']) {
      assert.throws(() => assertSistemaUpdate(rec, { activa: v }, { activeField: 'activa' }), sistema);
    }
    for (const v of [true, 'true', undefined]) {
      assert.doesNotThrow(() => assertSistemaUpdate(rec, { activa: v }, { activeField: 'activa' }));
    }
    assert.equal(isFalsy(null), false);
  });

  it('non-system records are unrestricted', () => {
    assert.doesNotThrow(() => assertSistemaUpdate({ nombre: 'x', activa: true }, { nombre: 'y', activa: false }, { activeField: 'activa' }));
  });
});
