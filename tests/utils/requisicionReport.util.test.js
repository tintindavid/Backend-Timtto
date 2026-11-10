/**
 * requisiciones-e5-reporteria, task 1.6: pure calculations of the reporting (medians, percentile, Bogota range, errors) and
 * the safe pieces of the metrics/dashboard definitions. No database.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { median, percentile, summarizeHours, resolveRange, bogotaDateString, mapReportError } from '../../src/utils/requisicionReport.util.js';
import { buildPipeline, buildBaseMatch, CICLOS } from '../../src/services/requisicionMetricas.service.js';
import { tenantFacets, PERSONAL_VISTAS } from '../../src/services/requisicionTablero.service.js';
import { queryMetricasDto, queryTableroDto, queryComparativoExportDto, queryExportListadoDto } from '../../src/dtos/requisicionReporte.dto.js';
import { REQUISICION_ACCIONES_HISTORIAL, REQUISICION_ACCIONES_HISTORIAL_VALUES } from '../../src/constants/requisicion.constants.js';

describe('percentile / median / summarizeHours', () => {
  it('median of 10 and 20 hours is 15', () => {
    assert.equal(median([10, 20]), 15);
    assert.deepEqual(summarizeHours([10, 20]), { n: 2, medianaHoras: 15, p90Horas: 19 });
  });
  it('odd sample, unsorted input and a single value', () => {
    assert.equal(median([9, 1, 5]), 5);
    assert.equal(percentile([7], 90), 7);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);
  });
  it('no sample -> n 0 and null values; NaN / negative entries are ignored', () => {
    assert.deepEqual(summarizeHours([]), { n: 0, medianaHoras: null, p90Horas: null });
    assert.deepEqual(summarizeHours([NaN, -3, 4]), { n: 1, medianaHoras: 4, p90Horas: 4 });
    assert.equal(percentile(undefined, 50), null);
  });
});

describe('resolveRange (America/Bogota)', () => {
  const now = new Date('2026-11-10T03:00:00.000Z'); // 2026-11-09 22:00 in Bogota
  it('defaults to the last 90 days ending today in Bogota', () => {
    assert.equal(bogotaDateString(now), '2026-11-09');
    const r = resolveRange({}, now);
    assert.equal(r.hasta, '2026-11-09');
    assert.equal(r.desde, '2026-08-12');
    assert.equal(r.dias, 90);
    assert.equal(r.from.toISOString(), '2026-08-12T05:00:00.000Z');
    assert.equal(r.to.toISOString(), '2026-11-10T04:59:59.999Z');
  });
  it('accepts exactly 366 days and rejects 367', () => {
    assert.equal(resolveRange({ desde: '2025-11-09', hasta: '2026-11-09' }, now).dias, 366);
    assert.throws(() => resolveRange({ desde: '2025-11-08', hasta: '2026-11-09' }, now), (e) => e.statusCode === 400 && e.code === 'RANGO_DEMASIADO_AMPLIO');
  });
  it('rejects inverted ranges and malformed / impossible dates with 400', () => {
    assert.throws(() => resolveRange({ desde: '2026-11-09', hasta: '2026-11-01' }, now), (e) => e.statusCode === 400);
    assert.throws(() => resolveRange({ desde: '2026-02-30' }, now), (e) => e.statusCode === 400);
    assert.throws(() => resolveRange({ hasta: 'ayer' }, now), (e) => e.statusCode === 400);
  });
  it('only `hasta` or only `desde` fill the other side', () => {
    assert.equal(resolveRange({ hasta: '2026-03-31' }, now).desde, '2026-01-01');
    assert.equal(resolveRange({ desde: '2026-11-01' }, now).hasta, '2026-11-09');
  });
});

describe('mapReportError', () => {
  it('maps MaxTimeMSExpired to 503 REPORTE_LENTO and keeps any other error', () => {
    const slow = mapReportError(Object.assign(new Error('x'), { code: 50 }));
    assert.equal(slow.statusCode, 503);
    assert.equal(slow.code, 'REPORTE_LENTO');
    assert.equal(mapReportError({ codeName: 'MaxTimeMSExpired' }).code, 'REPORTE_LENTO');
    const other = new Error('boom');
    assert.equal(mapReportError(other), other);
  });
});

describe('aggregation definitions', () => {
  const range = resolveRange({ desde: '2026-01-01', hasta: '2026-01-31' });
  it('the metrics pipeline starts with the tenant match and every currency group is by currency', () => {
    const p = buildPipeline('acme', range, { areaId: '507f1f77bcf86cd799439011', moneda: 'usd' });
    assert.equal(p[0].$match.tenantId, 'acme');
    assert.equal(p[0].$match.moneda, 'USD');
    assert.ok(p[0].$match.isDeleted);
    const facet = p.at(-1).$facet;
    assert.equal(facet.valor[1].$group._id, '$oc.moneda');
    assert.equal(facet.estimadoReal[1].$group._id, '$oc.moneda');
    assert.ok(facet.topProveedores.some((st) => st.$project));
    for (const [key] of CICLOS) assert.ok(facet[`ciclo_${key}`]);
  });
  it('the supplier filter is applied after the winner is computed', () => {
    const p = buildPipeline('acme', range, { proveedorId: '507f1f77bcf86cd799439011' });
    const idx = p.findIndex((s) => s.$match && s.$match.proveedorId);
    assert.ok(idx > p.findIndex((s) => s.$addFields));
    assert.equal(buildBaseMatch('acme', range, {}).areaId, undefined);
  });
  it('tenant facets: nine counters, links only where the list has an equivalent', () => {
    const f = tenantFacets(new Date('2026-11-09T12:00:00Z'));
    assert.deepEqual(f.map((x) => x[0]), ['porAprobar', 'ocPorAprobar', 'licitacionesAbiertas', 'licitacionesPorVencer', 'licitacionesVencidas', 'porRecibir', 'porConfirmar', 'entregablesPendientes', 'sinMovimiento']);
        assert.deepEqual(f[1][2], { alcance: 'tenant', filtro: 'oc-por-aprobar' });
    assert.deepEqual(f[0][2], { alcance: 'tenant', estado: 'En_Aprobacion' });
    assert.deepEqual(PERSONAL_VISTAS.map((x) => x[0]), ['mias', 'porAprobar', 'ocPorAprobar', 'porRecibir', 'porConfirmar']);
    const sinMov = f.find((x) => x[0] === 'sinMovimiento')[1];
    assert.deepEqual(sinMov.estado.$nin.sort(), ['Borrador', 'Cancelada', 'Cerrada', 'Rechazada']);
  });
});

describe('DTOs of the reporting', () => {
  const ok = (dto, value) => assert.equal(dto.validate(value).error, undefined, JSON.stringify(value));
  const bad = (dto, value) => assert.ok(dto.validate(value).error, JSON.stringify(value));
  it('metrics query is a strict allowlist', () => {
    ok(queryMetricasDto, {});
    ok(queryMetricasDto, { desde: '2026-01-01', hasta: '2026-02-01', areaId: '507f1f77bcf86cd799439011', tipoId: '507f1f77bcf86cd799439011', proveedorId: '507f1f77bcf86cd799439011', moneda: 'cop' });
    bad(queryMetricasDto, { tenantId: 'otro' });
    bad(queryMetricasDto, { desde: '01/01/2026' });
    bad(queryMetricasDto, { areaId: 'x' });
    bad(queryMetricasDto, { moneda: 'pesos' });
    bad(queryTableroDto, { userId: 'x' });
  });
  it('export DTOs: format and vistas', () => {
    ok(queryComparativoExportDto, { formato: 'pdf' });
    ok(queryComparativoExportDto, { formato: 'xlsx' });
    bad(queryComparativoExportDto, { formato: 'docx' });
    bad(queryComparativoExportDto, {});
    ok(queryExportListadoDto, { estado: 'Cerrada', fechaDesde: '2026-01-01', vista: 'mias' });
    ok(queryExportListadoDto, { vista: 'mi-historial', accion: 'emiti', page: 2, limit: 10 });
    ok(queryExportListadoDto, { alcance: 'tenant', filtro: 'sin-movimiento' });
    bad(queryExportListadoDto, { alcance: 'tenant', vista: 'mias' });
    bad(queryExportListadoDto, { filtro: 'sin-movimiento' });
    bad(queryExportListadoDto, { alcance: 'tenant', filtro: 'otro' });
    bad(queryExportListadoDto, { fechaDesde: '2026-02-31' });
    bad(queryMetricasDto, { desde: '2026-02-31' });
    bad(queryExportListadoDto, { tenantId: 'x' });
  });
});

describe('Mi historial: purchase order actions', () => {
  it('emiti / aprobe-oc are accepted, in `todo`, and `aprobe` is unchanged', () => {
    assert.deepEqual([...REQUISICION_ACCIONES_HISTORIAL.emiti], ['OC_EMITIDA', 'OC_EDITADA']);
    assert.deepEqual([...REQUISICION_ACCIONES_HISTORIAL['aprobe-oc']], ['OC_APROBADA', 'OC_RECHAZADA']);
    assert.deepEqual([...REQUISICION_ACCIONES_HISTORIAL.aprobe], ['NIVEL_APROBADO']);
    assert.ok(REQUISICION_ACCIONES_HISTORIAL_VALUES.includes('emiti') && REQUISICION_ACCIONES_HISTORIAL_VALUES.includes('aprobe-oc'));
  });
});
