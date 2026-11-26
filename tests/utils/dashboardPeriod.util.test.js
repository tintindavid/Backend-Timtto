import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod, periodoResponse, toBogotaYm } from '../../src/utils/dashboardPeriod.util.js';

const iso = (d) => d.toISOString();

describe('resolvePeriod', () => {
  it('defaults to the current month in Bogota time', () => {
    const p = resolvePeriod({}, new Date('2026-11-13T15:00:00Z'));
    assert.equal(iso(p.inicio), '2026-11-01T05:00:00.000Z');
    assert.equal(iso(p.fin), '2026-12-01T05:00:00.000Z');
    assert.equal(p.etiqueta, 'Noviembre 2026');
    assert.deepEqual(p.mesesAnio, [{ anio: 2026, mes: 11, clave: '2026-11' }]);
    assert.deepEqual(periodoResponse(p), { desde: '2026-11-01', hasta: '2026-11-30', etiqueta: 'Noviembre 2026' });
  });

  it('03:00Z of the 1st still belongs to the previous month (Bogota boundary)', () => {
    const p = resolvePeriod({}, new Date('2026-12-01T03:00:00Z'));
    assert.equal(p.etiqueta, 'Noviembre 2026');
    assert.equal(toBogotaYm(new Date('2026-12-01T03:00:00Z')), '2026-11');
    assert.equal(toBogotaYm(new Date('2026-12-01T05:00:00Z')), '2026-12');
  });

  it('mes_anterior crosses the year boundary', () => {
    const p = resolvePeriod({ periodo: 'mes_anterior' }, new Date('2027-01-10T12:00:00Z'));
    assert.equal(p.etiqueta, 'Diciembre 2026');
    assert.equal(iso(p.inicio), '2026-12-01T05:00:00.000Z');
    assert.equal(iso(p.fin), '2027-01-01T05:00:00.000Z');
    assert.equal(p.previo.etiqueta, 'Noviembre 2026');
  });

  it('previous period of a month is the previous month, whatever its length', () => {
    const p = resolvePeriod({}, new Date('2026-03-15T12:00:00Z'));
    assert.equal(iso(p.previo.inicio), '2026-02-01T05:00:00.000Z');
    assert.equal(iso(p.previo.fin), '2026-03-01T05:00:00.000Z');
    assert.deepEqual(p.previo.mesesAnio, [{ anio: 2026, mes: 2, clave: '2026-02' }]);
  });

  it('anio covers the 12 months and its previous period is the previous year', () => {
    const p = resolvePeriod({ periodo: 'anio', anio: 2026 });
    assert.equal(p.mesesAnio.length, 12);
    assert.equal(iso(p.inicio), '2026-01-01T05:00:00.000Z');
    assert.equal(iso(p.fin), '2027-01-01T05:00:00.000Z');
    assert.equal(p.etiqueta, '2026');
    assert.equal(p.previo.etiqueta, '2025');
    assert.equal(p.previo.mesesAnio[0].clave, '2025-01');
  });

  it('rango is inclusive of hasta (Bogota day) and the previous period has the same length', () => {
    const p = resolvePeriod({ periodo: 'rango', desde: '2026-11-10', hasta: '2026-11-19' });
    assert.equal(iso(p.inicio), '2026-11-10T05:00:00.000Z');
    assert.equal(iso(p.fin), '2026-11-20T05:00:00.000Z');
    assert.deepEqual(periodoResponse(p), { desde: '2026-11-10', hasta: '2026-11-19', etiqueta: '2026-11-10 a 2026-11-19' });
    assert.equal(iso(p.previo.inicio), '2026-10-01T05:00:00.000Z');
    assert.equal(iso(p.previo.fin), '2026-11-01T05:00:00.000Z');
    assert.deepEqual(p.previo.mesesAnio, [{ anio: 2026, mes: 10, clave: '2026-10' }]);
  });

  it('rango across a year boundary lists every year-month', () => {
    const p = resolvePeriod({ periodo: 'rango', desde: '2026-11-15', hasta: '2027-02-01' });
    assert.deepEqual(p.mesesAnio.map((m) => m.clave), ['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('a range across the year end: previous = the same number of months before the first month, no overlap', () => {
    const p = resolvePeriod({ periodo: 'rango', desde: '2026-12-20', hasta: '2027-01-05' });
    assert.deepEqual(p.mesesAnio.map((m) => m.clave), ['2026-12', '2027-01']);
    assert.deepEqual(p.previo.mesesAnio.map((m) => m.clave), ['2026-10', '2026-11']);
    assert.equal(iso(p.previo.fin), '2026-12-01T05:00:00.000Z');
    const edge = resolvePeriod({ periodo: 'rango', desde: '2026-12-31', hasta: '2026-12-31' });
    assert.deepEqual(edge.mesesAnio.map((m) => m.clave), ['2026-12']);
  });

  it('accepts exactly 24 months and rejects 25 with PERIOD_TOO_LARGE', () => {
    const ok = resolvePeriod({ periodo: 'rango', desde: '2024-01-01', hasta: '2025-12-31' });
    assert.equal(ok.mesesAnio.length, 24);
    assert.throws(
      () => resolvePeriod({ periodo: 'rango', desde: '2024-01-01', hasta: '2026-01-31' }),
      (e) => e.statusCode === 400 && e.code === 'PERIOD_TOO_LARGE',
    );
  });

  it('invalid combinations and dates are 400 VALIDATION_ERROR', () => {
    const bad = (params) => assert.throws(() => resolvePeriod(params), (e) => e.statusCode === 400 && e.code === 'VALIDATION_ERROR');
    bad({ periodo: 'rango' });
    bad({ periodo: 'rango', desde: '2026-11-10' });
    bad({ periodo: 'rango', desde: '2026-02-31', hasta: '2026-03-01' });
    bad({ periodo: 'rango', desde: '2026-11-10', hasta: '2026-11-09' });
    bad({ periodo: 'mes_actual', desde: '2026-11-01', hasta: '2026-11-02' });
    bad({ periodo: 'mes_actual', anio: 2026 });
    bad({ periodo: 'semana' });
    bad({ periodo: 'anio', anio: 1850 });
  });
});
