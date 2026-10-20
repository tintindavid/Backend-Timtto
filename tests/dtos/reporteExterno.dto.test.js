import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createReporteExternoDto } from '../../src/dtos/reporteExterno.dto.js';

const valid = () => ({ tipoMtto: 'Preventivo', fecha: '2026-03-12', estadoOperativo: 'Operativo', proveedor: 'Taller' });
const check = (body) => createReporteExternoDto.validate(body);

describe('createReporteExternoDto', () => {
  it('accepts the minimal body', () => {
    assert.equal(check(valid()).error, undefined);
  });

  it('accepts a registered provider without a name', () => {
    const { proveedor, ...rest } = valid();
    assert.equal(check({ ...rest, proveedorId: '507f1f77bcf86cd799439021' }).error, undefined);
  });

  it('requires a provider: id or name', () => {
    const { proveedor, ...rest } = valid();
    assert.ok(check(rest).error);
  });

  it('rejects a malformed provider id', () => {
    assert.ok(check({ ...valid(), proveedorId: 'abc' }).error);
  });

  it('only Preventivo and Correctivo are allowed', () => {
    assert.ok(check({ ...valid(), tipoMtto: 'Predictivo' }).error);
    assert.equal(check({ ...valid(), tipoMtto: 'Correctivo' }).error, undefined);
  });

  it('the date is required, ISO and not in the future', () => {
    const { fecha, ...rest } = valid();
    assert.ok(check(rest).error);
    assert.ok(check({ ...valid(), fecha: 'ayer' }).error);
    assert.ok(check({ ...valid(), fecha: new Date(Date.now() + 3 * 86400000).toISOString() }).error);
  });

  it('the operative state must be one of the known values', () => {
    assert.ok(check({ ...valid(), estadoOperativo: 'Roto' }).error);
    assert.equal(check({ ...valid(), estadoOperativo: 'Fuera de Servicio' }).error, undefined);
  });

  it('never accepts the consecutive, the tenant, the state or the origin from the client', () => {
    for (const extra of [{ consecutivo: 'R1' }, { tenantId: 'x' }, { estado: 'Pendiente' }, { origen: 'interno' }, { orden: '507f1f77bcf86cd799439022' }]) {
      assert.ok(check({ ...valid(), ...extra }).error, JSON.stringify(extra));
    }
  });

  it('the link must be http(s)', () => {
    assert.equal(check({ ...valid(), enlace: 'https://x.example/doc' }).error, undefined);
    assert.ok(check({ ...valid(), enlace: 'javascript:alert(1)' }).error);
    assert.ok(check({ ...valid(), enlace: 'ftp://x.example' }).error);
  });

  it('verification rows: numbers or numeric strings, limited text, no extra fields', () => {
    assert.equal(check({ ...valid(), verificationParam: [{ magnitud: 'P', unidad: 'mmHg', valorReferencia: '120', valorMedido: 118.5, patron: 'F' }] }).error, undefined);
    assert.ok(check({ ...valid(), verificationParam: [{ magnitud: 'P', valorMedido: 'abc' }] }).error);
    assert.ok(check({ ...valid(), verificationParam: [{ magnitud: 'x'.repeat(200) }] }).error);
    assert.ok(check({ ...valid(), verificationParam: [{ magnitud: 'P', extra: 1 }] }).error);
  });

  it('at most 50 verification rows', () => {
    const rows = Array.from({ length: 51 }, () => ({ magnitud: 'P' }));
    assert.ok(check({ ...valid(), verificationParam: rows }).error);
  });
});

describe('createReporteExternoDto - date', () => {
  const base = { tipoMtto: 'Preventivo', estadoOperativo: 'Operativo', proveedor: 'Taller' };

  it('a date-only value is stored at midday UTC so no timezone shows the day before', () => {
    const { value, error } = createReporteExternoDto.validate({ ...base, fecha: '2026-03-12' });
    assert.equal(error, undefined);
    assert.equal(value.fecha.toISOString(), '2026-03-12T12:00:00.000Z');
  });

  it('a value that carries a time is kept as sent', () => {
    const { value } = createReporteExternoDto.validate({ ...base, fecha: '2026-03-12T15:30:00.000Z' });
    assert.equal(value.fecha.toISOString(), '2026-03-12T15:30:00.000Z');
  });
});
