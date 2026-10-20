import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createActividadExternaDto, updateActividadExternaDto, cerrarCadenaDto } from '../../src/dtos/actividadExterna.dto.js';

describe('createActividadExternaDto', () => {
  const valid = {
    tipo: 'calibracion',
    consecutivoExterno: 'CAL-001',
    fecha: '2026-01-15',
    proveedor: 'ACME',
    estadoFinal: 'aprobada',
    frecuencia: { meses: 12, esUnica: false },
  };
  it('acepta payload válido', () => {
    const { error } = createActividadExternaDto.validate(valid);
    assert.equal(error, undefined);
  });
  it('rechaza tipo = otro sin tipoCustom', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, tipo: 'otro' });
    assert.match(error.message, /tipoCustom/);
  });
  it('rechaza esUnica = false sin meses', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, frecuencia: { esUnica: false } });
    assert.match(error.message, /meses/);
  });
  it('rechaza enlace que no sea http(s)', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, enlace: 'ftp://x' });
    assert.ok(error);
  });
  it('rechaza estadoFinal = otro sin estadoFinalCustom', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, estadoFinal: 'otro' });
    assert.match(error.message, /estadoFinalCustom/);
  });
  it('rechaza fecha futura', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, fecha: new Date(Date.now() + 86400000).toISOString() });
    assert.ok(error);
  });
  it('rechaza campos desconocidos (tenantId)', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, tenantId: 't1' });
    assert.ok(error);
  });
  it('rechaza enlace javascript:', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, enlace: 'javascript:alert(1)' });
    assert.ok(error);
  });
  it('acepta cadenaIdSucesion como ObjectId string', () => {
    const { error } = createActividadExternaDto.validate({ ...valid, cadenaIdSucesion: '507f1f77bcf86cd799439011' });
    assert.equal(error, undefined);
  });
});

describe('updateActividadExternaDto', () => {
  for (const [campo, valor] of [['fecha', '2026-02-01'], ['consecutivoExterno', 'X-1'], ['tipo', 'calibracion']]) {
    it(`rechaza actualizar ${campo}`, () => {
      const { error } = updateActividadExternaDto.validate({ observacion: 'n', [campo]: valor });
      assert.ok(error);
    });
  }
  it('rechaza objeto vacío', () => {
    const { error } = updateActividadExternaDto.validate({});
    assert.ok(error);
  });
  it('acepta campos editables', () => {
    const { error } = updateActividadExternaDto.validate({ observacion: 'Nota', estadoFinal: 'rechazada' });
    assert.equal(error, undefined);
  });
});

describe('cerrarCadenaDto', () => {
  it('rechaza {}', () => {
    assert.ok(cerrarCadenaDto.validate({}).error);
  });
  it('acepta motivoCierre', () => {
    assert.equal(cerrarCadenaDto.validate({ motivoCierre: 'baja equipo' }).error, undefined);
  });
});

describe('provider fields of the external activity DTOs', () => {
  const PROV = '507f1f77bcf86cd799439021';
  const base = {
    tipo: 'calibracion', consecutivoExterno: 'CAL-001', fecha: '2026-01-15',
    estadoFinal: 'aprobada', frecuencia: { meses: 12, esUnica: false },
  };

  it('create accepts a proveedorId without a name', () => {
    const { error } = createActividadExternaDto.validate({ ...base, proveedorId: PROV });
    assert.equal(error, undefined);
  });

  it('create accepts a name without proveedorId', () => {
    const { error } = createActividadExternaDto.validate({ ...base, proveedor: 'ACME' });
    assert.equal(error, undefined);
  });

  it('create rejects neither proveedorId nor proveedor', () => {
    const { error } = createActividadExternaDto.validate(base);
    assert.ok(error);
  });

  it('create rejects a malformed proveedorId', () => {
    const { error } = createActividadExternaDto.validate({ ...base, proveedorId: 'abc' });
    assert.ok(error);
  });

  it('update accepts a proveedorId, a name, null and the empty string (unlink)', () => {
    for (const body of [{ proveedorId: PROV }, { proveedor: 'Nuevo' }, { proveedorId: null }, { proveedorId: '' }]) {
      const { error } = updateActividadExternaDto.validate(body);
      assert.equal(error, undefined, JSON.stringify(body));
    }
  });

  it('update rejects a malformed proveedorId', () => {
    const { error } = updateActividadExternaDto.validate({ proveedorId: 'abc' });
    assert.ok(error);
  });
});

describe('estadoOperativo of the external activity', () => {
  const base = {
    tipo: 'calibracion', consecutivoExterno: 'CAL-001', fecha: '2026-01-15', proveedor: 'ACME',
    estadoFinal: 'aprobada', frecuencia: { meses: 12, esUnica: false },
  };
  it('is optional so activities loaded without it stay valid', () => {
    assert.equal(createActividadExternaDto.validate(base).error, undefined);
  });
  it('accepts the shared operative states', () => {
    for (const estado of ['Operativo', 'Fuera de Servicio', 'En Mantenimiento', 'Espera de Repuestos', 'En Reparacion']) {
      assert.equal(createActividadExternaDto.validate({ ...base, estadoOperativo: estado }).error, undefined, estado);
    }
  });
  it('rejects anything else, including the result values', () => {
    assert.ok(createActividadExternaDto.validate({ ...base, estadoOperativo: 'aprobada' }).error);
    assert.ok(createActividadExternaDto.validate({ ...base, estadoOperativo: 'Roto' }).error);
  });
  it('cannot be edited afterwards', () => {
    assert.ok(updateActividadExternaDto.validate({ estadoOperativo: 'Operativo' }).error);
  });
});
