/**
 * requisiciones-e1-base-aprobacion, tasks 2.3 / 2.5 / 2.6: Area, TipoRequisicion, ReglaAprobacion, PresupuestoArea
 * models and the additive optional fields on User and Repuestos. DB-free (schema validation and index metadata).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { User } from '../../src/models/user.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { createRepuestosDto } from '../../src/dtos/createRepuestos.dto.js';
import { updateRepuestosDto } from '../../src/dtos/updateRepuestos.dto.js';

const oid = () => new mongoose.Types.ObjectId();
const indexOf = (Model, keys) => Model.schema.indexes().find(([k]) => JSON.stringify(k) === JSON.stringify(keys));

describe('soft delete + tenant invariants of the new collections', () => {
  for (const [name, Model] of [['Area', Area], ['TipoRequisicion', TipoRequisicion], ['ReglaAprobacion', ReglaAprobacion], ['PresupuestoArea', PresupuestoArea]]) {
    it(`${name}: tenantId required, isDeleted default false, timestamps, no __v, toJSON hides soft-delete fields`, () => {
      assert.equal(Model.schema.path('tenantId').isRequired, true);
      assert.equal(Model.schema.path('isDeleted').options.default, false);
      assert.equal(Model.schema.options.timestamps, true);
      assert.equal(Model.schema.options.versionKey, false);
      assert.ok(indexOf(Model, { tenantId: 1, isDeleted: 1 }), 'compound (tenantId, isDeleted) index');
      const doc = new Model({ tenantId: 'a' });
      const json = doc.toJSON();
      assert.equal('isDeleted' in json, false);
      assert.equal('deletedAt' in json, false);
    });
  }
});

describe('Area', () => {
  it('uppercases and trims codigo, defaults to active, and the code is immutable', () => {
    const a = new Area({ tenantId: 'a', nombre: ' Mantenimiento ', codigo: ' mtto ' });
    assert.equal(a.nombre, 'Mantenimiento');
    assert.equal(a.codigo, 'MTTO');
    assert.equal(a.activa, true);
    assert.deepEqual([...a.jefesIds], []);
    assert.equal(Area.schema.path('codigo').options.immutable, true);
    assert.equal(a.validateSync(), undefined);
  });

  it('admits at most 10 heads', () => {
    const jefes = (n) => Array.from({ length: n }, oid);
    assert.equal(new Area({ tenantId: 'a', nombre: 'X', codigo: 'X', jefesIds: jefes(10) }).validateSync(), undefined);
    assert.ok(new Area({ tenantId: 'a', nombre: 'X', codigo: 'X', jefesIds: jefes(11) }).validateSync()?.errors.jefesIds);
  });

  it('requires nombre and codigo', () => {
    const err = new Area({ tenantId: 'a' }).validateSync();
    assert.ok(err.errors.nombre && err.errors.codigo);
  });

  it('indexes: unique (tenantId, codigo) among live areas and unique case-insensitive (tenantId, nombre)', () => {
    const code = indexOf(Area, { tenantId: 1, codigo: 1 });
    assert.equal(code[1].unique, true);
    assert.deepEqual(code[1].partialFilterExpression, { isDeleted: false });
    const name = indexOf(Area, { tenantId: 1, nombre: 1 });
    assert.equal(name[1].unique, true);
    assert.equal(name[1].collation.strength, 2);
  });
});

describe('TipoRequisicion', () => {
  it('uppercases codigo, defaults to active and has unique live (tenantId, codigo)', () => {
    const t = new TipoRequisicion({ tenantId: 'a', nombre: 'General', codigo: 'general' });
    assert.equal(t.codigo, 'GENERAL');
    assert.equal(t.activo, true);
    assert.equal(TipoRequisicion.schema.path('codigo').options.immutable, true);
    const idx = indexOf(TipoRequisicion, { tenantId: 1, codigo: 1 });
    assert.equal(idx[1].unique, true);
    assert.deepEqual(idx[1].partialFilterExpression, { isDeleted: false });
  });
});

describe('ReglaAprobacion', () => {
  const base = { tenantId: 'a', orden: 1, nombre: 'Jefe', montoDesde: 0, aprobadorTipo: 'jefe_area' };

  it('accepts a head-of-area rule with no upper limit', () => {
    const r = new ReglaAprobacion(base);
    assert.equal(r.validateSync(), undefined);
    assert.equal(r.montoHasta, null);
    assert.equal(r.activo, true);
  });

  it('montoHasta must be greater than montoDesde (document hook; update validators do not depend on `this`)', async () => {
    await assert.rejects(() => new ReglaAprobacion({ ...base, montoDesde: 100, montoHasta: 100 }).validate(), /montoHasta/);
    await assert.rejects(() => new ReglaAprobacion({ ...base, montoDesde: 100, montoHasta: 50 }).validate(), /montoHasta/);
    await new ReglaAprobacion({ ...base, montoDesde: 100, montoHasta: 101 }).validate();
    await new ReglaAprobacion({ ...base, montoDesde: 100, montoHasta: null }).validate();
  });

  it('tipo rol needs rolId and tipo usuarios needs users (scenario: Tipo rol sin rol)', async () => {
    await assert.rejects(() => new ReglaAprobacion({ ...base, aprobadorTipo: 'rol' }).validate(), /rolId/);
    await new ReglaAprobacion({ ...base, aprobadorTipo: 'rol', rolId: oid() }).validate();
    await assert.rejects(() => new ReglaAprobacion({ ...base, aprobadorTipo: 'usuarios' }).validate(), /usuariosIds/);
    await new ReglaAprobacion({ ...base, aprobadorTipo: 'usuarios', usuariosIds: [oid()] }).validate();
  });

  it('rejects an unknown approver type, negative amounts and a non-integer order', () => {
    assert.ok(new ReglaAprobacion({ ...base, aprobadorTipo: 'gerente' }).validateSync()?.errors.aprobadorTipo);
    assert.ok(new ReglaAprobacion({ ...base, montoDesde: -1 }).validateSync()?.errors.montoDesde);
    assert.ok(new ReglaAprobacion({ ...base, orden: 1.5 }).validateSync()?.errors.orden);
    assert.ok(new ReglaAprobacion({ ...base, orden: 0 }).validateSync()?.errors.orden);
  });
});

describe('PresupuestoArea', () => {
  const base = { tenantId: 'a', areaId: oid(), periodo: '2026', monto: 1000 };

  it('accepts year and month periods and defaults currency COP and alert threshold 80', () => {
    const y = new PresupuestoArea(base);
    assert.equal(y.validateSync(), undefined);
    assert.equal(y.moneda, 'COP');
    assert.equal(y.umbralAlerta, 80);
    assert.equal(new PresupuestoArea({ ...base, periodo: '2026-03' }).validateSync(), undefined);
  });

  it('rejects malformed periods, negative amounts and thresholds outside 1..100', () => {
    for (const periodo of ['26', '2026-13', '2026-3', 'marzo']) assert.ok(new PresupuestoArea({ ...base, periodo }).validateSync()?.errors.periodo, periodo);
    assert.ok(new PresupuestoArea({ ...base, monto: -1 }).validateSync()?.errors.monto);
    assert.ok(new PresupuestoArea({ ...base, umbralAlerta: 0 }).validateSync()?.errors.umbralAlerta);
    assert.ok(new PresupuestoArea({ ...base, umbralAlerta: 101 }).validateSync()?.errors.umbralAlerta);
  });

  it('is unique per (tenant, area, period) among live rows, so a year and a month budget coexist', () => {
    const idx = indexOf(PresupuestoArea, { tenantId: 1, areaId: 1, periodo: 1 });
    assert.equal(idx[1].unique, true);
    assert.deepEqual(idx[1].partialFilterExpression, { isDeleted: false });
  });
});

describe('additive optional fields (no default, outside existing DTOs)', () => {
  it('User.areaId is optional, has no default and is not serialized when absent', () => {
    const u = new User({ tenantId: 'a', email: 'a@b.co', password: 'x' });
    assert.equal(u.areaId, undefined);
    assert.equal(u.validateSync(), undefined);
    assert.equal('areaId' in u.toJSON(), false);
    const area = oid();
    assert.equal(String(new User({ tenantId: 'a', email: 'a@b.co', password: 'x', areaId: area }).areaId), String(area));
  });

  it('Repuestos.requisicion and stockDescontadoPor are optional with no default and a legacy document is unchanged', () => {
    const r = new Repuestos({
      tenantId: 'a', Cantidad: '1', nombre: 'Sensor', EquipoId: oid(), OrdenId: oid(), ReporteSolicitudId: oid(), ResponsableSolicitud: oid(),
    });
    assert.equal(r.requisicion, undefined);
    assert.equal(r.stockDescontadoPor, undefined);
    assert.equal(r.validateSync(), undefined);
    const obj = r.toObject();
    assert.equal('requisicion' in obj, false);
    assert.equal('stockDescontadoPor' in obj, false);
  });

  it('Repuestos.toJSON never exposes the Requisiciones fields', () => {
    const r = new Repuestos({
      tenantId: 'a', Cantidad: '1', nombre: 'Sensor', EquipoId: oid(), OrdenId: oid(), ReporteSolicitudId: oid(), ResponsableSolicitud: oid(),
      requisicion: { requisicionId: oid(), lineaId: oid(), disponibilidad: 'Disponible' },
      stockDescontadoPor: 'requisicion',
    });
    assert.equal(r.validateSync(), undefined);
    const json = r.toJSON();
    assert.equal('requisicion' in json, false);
    assert.equal('stockDescontadoPor' in json, false);
  });

  it('the existing Repuestos create / update DTOs reject both fields', () => {
    const payload = {
      nombre: 'S', Cantidad: 1, EquipoId: 'a'.repeat(24), OrdenId: 'a'.repeat(24), ResponsableSolicitud: 'a'.repeat(24),
    };
    assert.equal(createRepuestosDto.validate(payload).error, undefined);
    assert.ok(createRepuestosDto.validate({ ...payload, requisicion: { requisicionId: 'a'.repeat(24) } }).error);
    assert.ok(createRepuestosDto.validate({ ...payload, stockDescontadoPor: 'requisicion' }).error);
    assert.equal(updateRepuestosDto.validate({ nombre: 'S' }).error, undefined);
    assert.ok(updateRepuestosDto.validate({ requisicion: {} }).error);
    assert.ok(updateRepuestosDto.validate({ stockDescontadoPor: 'requisicion' }).error);
  });
});
