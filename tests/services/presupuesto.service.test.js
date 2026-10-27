/**
 * requisiciones-e1-base-aprobacion, tasks 3.4 and 3.6: area budgets and the informative summary
 * (consumido / comprometido / disponible / alerta / sobrepasado, tenant + isDeleted in the aggregation).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { Area } from '../../src/models/area.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { presupuestoAreaService } from '../../src/services/presupuestoArea.service.js';
import { presupuestoService } from '../../src/services/presupuesto.service.js';
import { createPresupuestoAreaDto, updatePresupuestoAreaDto, resumenPresupuestoDto, queryPresupuestoAreaDto } from '../../src/dtos/presupuestoArea.dto.js';
import { stubModel } from '../helpers/memoryModel.js';

const AREA = new mongoose.Types.ObjectId().toString();
const OTHER_AREA = new mongoose.Types.ObjectId().toString();

let presupuestos;
let areas;
let requisiciones;
let pipelines;
let tenantSettings;
let restore;
const saved = {};

/** Evaluates the $match / $group the service sends over the in-memory requisitions. */
function fakeAggregate(pipeline) {
  pipelines.push(pipeline);
  const [{ $match }] = pipeline;
  const field = Object.keys($match).find((k) => k === 'aprobadaAt' || k === 'enviadaAt');
  const range = $match[field];
  const rows = requisiciones.filter((r) =>
    r.tenantId === $match.tenantId
    && r.isDeleted === $match.isDeleted
    && String(r.areaId) === String($match.areaId)
    && $match.estado.$in.includes(r.estado)
    && r[field] >= range.$gte && r[field] < range.$lt);
  return Promise.resolve(rows.length ? [{ _id: null, total: rows.reduce((s, r) => s + r.montoEstimado, 0) }] : []);
}

const req = (over) => ({
  tenantId: 'acme', isDeleted: false, areaId: AREA, estado: 'Aprobada', montoEstimado: 100,
  aprobadaAt: new Date('2026-03-10T12:00:00Z'), enviadaAt: new Date('2026-03-05T12:00:00Z'), ...over,
});

beforeEach(() => {
  presupuestos = [];
  areas = [{ _id: AREA, tenantId: 'acme', activa: true }, { _id: OTHER_AREA, tenantId: 'globex', activa: true }];
  requisiciones = [];
  pipelines = [];
  tenantSettings = undefined;
  const restores = [stubModel(PresupuestoArea, presupuestos), stubModel(Area, areas)];
  saved.aggregate = Requisicion.aggregate;
  saved.tenantFindOne = Tenant.findOne;
  Requisicion.aggregate = fakeAggregate;
  Tenant.findOne = () => ({ lean: async () => (tenantSettings ? { settings: tenantSettings } : null) });
  restore = () => {
    restores.forEach((r) => r());
    Requisicion.aggregate = saved.aggregate;
    Tenant.findOne = saved.tenantFindOne;
  };
});
afterEach(() => restore());

describe('presupuestoAreaService', () => {
  it('creates a budget with the tenant base currency (default COP) and ignores body currency', async () => {
    const p = await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 1000, moneda: 'USD', tenantId: 'evil' });
    assert.equal(p.tenantId, 'acme');
    assert.equal(p.moneda, 'COP');
    tenantSettings = { currency: 'usd' };
    const q = await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026-03', monto: 10 });
    assert.equal(q.moneda, 'USD');
  });

  it('409 on a second budget for the same area and period; year and month are independent (scenarios)', async () => {
    await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 1000 });
    await assert.rejects(
      () => presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 5 }),
      { statusCode: 409, code: 'DUPLICATE_PRESUPUESTO' },
    );
    await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026-03', monto: 100 });
    assert.equal(presupuestos.length, 2);
  });

  it('a soft-deleted budget frees its slot', async () => {
    const p = await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 1000 });
    await presupuestoAreaService.delete('acme', p._id);
    await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 1 });
    assert.equal(presupuestos.length, 2);
  });

  it('400 AREA_INVALIDA for an area of another tenant', async () => {
    await assert.rejects(
      () => presupuestoAreaService.create('acme', { areaId: OTHER_AREA, periodo: '2026', monto: 1 }),
      { statusCode: 400, code: 'AREA_INVALIDA' },
    );
  });

  it('IDOR: another tenant gets 404 on read, update and delete', async () => {
    const p = await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 1000 });
    await assert.rejects(() => presupuestoAreaService.getById('globex', p._id), { statusCode: 404, code: 'PRESUPUESTO_NOT_FOUND' });
    await assert.rejects(() => presupuestoAreaService.update('globex', p._id, { monto: 1 }), { statusCode: 404 });
    await assert.rejects(() => presupuestoAreaService.delete('globex', p._id), { statusCode: 404 });
    assert.equal(presupuestos[0].monto, 1000);
  });

  it('update changes amount / threshold only and rounds the amount', async () => {
    const p = await presupuestoAreaService.create('acme', { areaId: AREA, periodo: '2026', monto: 1000 });
    const u = await presupuestoAreaService.update('acme', p._id, { monto: 1234.567, umbralAlerta: 90 });
    assert.equal(u.monto, 1234.57);
    assert.equal(u.umbralAlerta, 90);
  });
});

describe('presupuestoService.getResumen', () => {
  const seedBudget = (over = {}) => presupuestos.push({ _id: 'p1', tenantId: 'acme', areaId: AREA, periodo: '2026', monto: 1000, moneda: 'COP', umbralAlerta: 80, isDeleted: false, ...over });

  it('returns monto, consumido, comprometido, disponible, porcentaje and alert flags (scenario: Resumen de presupuesto)', async () => {
    seedBudget();
    requisiciones.push(
      req({ montoEstimado: 300 }), // consumed
      req({ estado: 'Enviada', montoEstimado: 200, aprobadaAt: null }), // committed
      req({ estado: 'En_Aprobacion', montoEstimado: 100, aprobadaAt: null }), // committed
    );
    const r = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    assert.deepEqual(
      { monto: r.monto, consumido: r.consumido, comprometido: r.comprometido, disponible: r.disponible, porcentaje: r.porcentaje, alerta: r.alerta, sobrepasado: r.sobrepasado, configurado: r.configurado },
      { monto: 1000, consumido: 300, comprometido: 300, disponible: 400, porcentaje: 60, alerta: false, sobrepasado: false, configurado: true },
    );
    assert.equal(r.moneda, 'COP');
    assert.equal(r.umbralAlerta, 80);
  });

  it('alerts at the threshold without blocking', async () => {
    seedBudget();
    requisiciones.push(req({ montoEstimado: 800 }));
    const r = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    assert.equal(r.porcentaje, 80);
    assert.equal(r.alerta, true);
    assert.equal(r.sobrepasado, false);
  });

  it('marks sobrepasado when consumed exceeds the budget (scenario: Presupuesto excedido)', async () => {
    seedBudget();
    requisiciones.push(req({ montoEstimado: 1200.5 }));
    const r = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    assert.equal(r.sobrepasado, true);
    assert.equal(r.alerta, true);
    assert.equal(r.disponible, -200.5);
  });

  it('only counts documents of the tenant and the area that are not deleted, with the right states and window', async () => {
    seedBudget();
    requisiciones.push(
      req({ montoEstimado: 100 }),
      req({ tenantId: 'globex', montoEstimado: 5000 }),
      req({ isDeleted: true, montoEstimado: 5000 }),
      req({ areaId: OTHER_AREA, montoEstimado: 5000 }),
      req({ estado: 'Borrador', montoEstimado: 5000 }),
      req({ estado: 'Rechazada', montoEstimado: 5000 }),
      req({ estado: 'Cancelada', montoEstimado: 5000 }),
      req({ aprobadaAt: new Date('2025-12-31T12:00:00Z'), montoEstimado: 5000 }), // previous year
    );
    const r = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    assert.equal(r.consumido, 100);
    assert.equal(r.comprometido, 0);
    for (const [{ $match }] of pipelines) {
      assert.equal($match.tenantId, 'acme', 'aggregation filters by tenantId');
      assert.equal($match.isDeleted, false, 'aggregation excludes deleted documents (scenario: Aislamiento)');
      assert.ok($match.areaId instanceof mongoose.Types.ObjectId);
    }
  });

  it('year and month budgets of the same area are computed over their own windows (Bogota time)', async () => {
    seedBudget();
    seedBudget({ _id: 'p2', periodo: '2026-03', monto: 500 });
    requisiciones.push(
      req({ montoEstimado: 100, aprobadaAt: new Date('2026-03-10T12:00:00Z') }),
      req({ montoEstimado: 40, aprobadaAt: new Date('2026-07-10T12:00:00Z') }),
      // 2026-04-01 02:00 UTC is still 2026-03-31 21:00 in Bogota -> March
      req({ montoEstimado: 7, aprobadaAt: new Date('2026-04-01T02:00:00Z') }),
    );
    const year = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    const month = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026-03' });
    assert.equal(year.consumido, 147);
    assert.equal(month.consumido, 107);
    assert.equal(month.monto, 500);
  });

  it('without a configured budget it still reports the amounts, flagged configurado:false', async () => {
    requisiciones.push(req({ montoEstimado: 50 }));
    const r = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    assert.equal(r.configurado, false);
    assert.equal(r.monto, null);
    assert.equal(r.disponible, null);
    assert.equal(r.porcentaje, null);
    assert.equal(r.consumido, 50);
    assert.equal(r.alerta, false);
  });

  it('IDOR: an area of another tenant is a 404 and never leaks totals', async () => {
    await assert.rejects(
      () => presupuestoService.getResumen('acme', { areaId: OTHER_AREA, periodo: '2026' }),
      { statusCode: 404, code: 'AREA_NOT_FOUND' },
    );
    assert.equal(pipelines.length, 0);
  });

  it('400 for a malformed period', async () => {
    await assert.rejects(() => presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026-13' }), { statusCode: 400, code: 'PERIODO_INVALIDO' });
  });

  it('sums money without floating point drift', async () => {
    seedBudget({ monto: 1 });
    requisiciones.push(req({ montoEstimado: 0.1 }), req({ montoEstimado: 0.2 }));
    const r = await presupuestoService.getResumen('acme', { areaId: AREA, periodo: '2026' });
    assert.equal(r.consumido, 0.3);
  });
});

describe('presupuestoArea DTOs', () => {
  const ok = { areaId: AREA, periodo: '2026-03', monto: 100 };

  it('validates period, amount, threshold and refuses currency / tenant from the body', () => {
    assert.equal(createPresupuestoAreaDto.validate(ok).error, undefined);
    assert.equal(createPresupuestoAreaDto.validate({ ...ok, periodo: '2026' }).error, undefined);
    assert.ok(createPresupuestoAreaDto.validate({ ...ok, periodo: '2026-13' }).error);
    assert.ok(createPresupuestoAreaDto.validate({ ...ok, monto: -1 }).error);
    assert.ok(createPresupuestoAreaDto.validate({ ...ok, umbralAlerta: 101 }).error);
    assert.ok(createPresupuestoAreaDto.validate({ ...ok, moneda: 'USD' }).error);
    assert.ok(createPresupuestoAreaDto.validate({ ...ok, tenantId: 'x' }).error);
  });

  it('update cannot move a budget to another area or period', () => {
    assert.ok(updatePresupuestoAreaDto.validate({ areaId: AREA }).error);
    assert.ok(updatePresupuestoAreaDto.validate({ periodo: '2027' }).error);
    assert.equal(updatePresupuestoAreaDto.validate({ monto: 5 }).error, undefined);
  });

  it('the summary query needs areaId and periodo', () => {
    assert.equal(resumenPresupuestoDto.validate({ areaId: AREA, periodo: '2026' }).error, undefined);
    assert.ok(resumenPresupuestoDto.validate({ areaId: AREA }).error);
    assert.ok(resumenPresupuestoDto.validate({ periodo: '2026' }).error);
    assert.equal(queryPresupuestoAreaDto.validate({}).error, undefined);
  });
});
