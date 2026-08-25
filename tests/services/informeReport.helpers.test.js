/**
 * tests/services/informeReport.helpers.test.js
 *
 * Unit tests for the shared informe primitives extracted per
 * openspec/changes/informes-por-ot-tab-con-firma-y-cumplimiento (tasks.md 1.4).
 * Pure functions — no DB, no mocking needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReportForMeses,
  classifyReportForOt,
  formatDate,
  toReportRow,
  toRepuestoRow,
  toEquipoResumen,
} from '../../src/services/informeReport.helpers.js';

describe('classifyReportForMeses', () => {
  it('estado Cancelado always wins', () => {
    assert.equal(classifyReportForMeses({ estado: 'Cancelado', fechaFinalizdo: new Date() }), 'Cancelado');
  });

  it('fechaFinalizdo present and not cancelled -> Realizado', () => {
    assert.equal(classifyReportForMeses({ estado: 'Cerrado', fechaFinalizdo: new Date() }), 'Realizado');
  });

  it('no fechaFinalizdo and not cancelled -> Programado', () => {
    assert.equal(classifyReportForMeses({ estado: 'Abierto', fechaFinalizdo: null }), 'Programado');
  });
});

describe('classifyReportForOt', () => {
  it('estado Cancelado -> Cancelado', () => {
    assert.equal(classifyReportForOt({ estado: 'Cancelado' }), 'Cancelado');
  });

  it('estado in {Cerrado, Procesado, Abierto} -> Cumplido', () => {
    assert.equal(classifyReportForOt({ estado: 'Cerrado' }), 'Cumplido');
    assert.equal(classifyReportForOt({ estado: 'Procesado' }), 'Cumplido');
    assert.equal(classifyReportForOt({ estado: 'Abierto' }), 'Cumplido');
  });

  it('anything else (including Pendiente / unknown) -> Pendiente', () => {
    assert.equal(classifyReportForOt({ estado: 'Pendiente' }), 'Pendiente');
    assert.equal(classifyReportForOt({ estado: 'En Progreso' }), 'Pendiente');
    assert.equal(classifyReportForOt({ estado: undefined }), 'Pendiente');
  });
});

describe('formatDate', () => {
  it('null input -> null', () => {
    assert.equal(formatDate(null), null);
  });

  it('invalid date -> null', () => {
    assert.equal(formatDate('not-a-date'), null);
  });

  it('valid ISO date -> es-CO formatted string', () => {
    const result = formatDate('2026-08-18T00:00:00.000Z');
    assert.match(result, /^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('toReportRow', () => {
  it('maps a report doc into the row shape', () => {
    const report = {
      _id: 'r1',
      consecutivo: 'R000112',
      equipoSnapshot: { ItemText: 'Monitor', Marca: 'Philips', Serie: 'S1', Sede: 'Sede A', Servicio: 'UCI', Modelo: 'M1', Inventario: 'INV1' },
      tipoMtto: 'Preventivo',
      estado: 'Cerrado',
      fechaFinalizdo: '2026-08-01T00:00:00.000Z',
      FechaCreacion: '2026-07-01T00:00:00.000Z',
      fechaProcesado: '2026-08-01T00:00:00.000Z',
      ResponsableMtto: { fullName: 'Juan Perez' },
      diagnostico: 'OK',
      accionTomada: 'Calibracion',
      observacion: 'Sin novedad',
      duracion: 30,
    };
    const row = toReportRow(report);
    assert.equal(row.consecutivo, 'R000112');
    assert.equal(row.equipoNombre, 'Monitor');
    assert.equal(row.marca, 'Philips');
    assert.equal(row.sede, 'Sede A');
    assert.equal(row.servicio, 'UCI');
    assert.equal(row.estado, 'Realizado');
    assert.equal(row.tecnico, 'Juan Perez');
    assert.equal(row.duracion, 30);
  });
});

describe('toRepuestoRow', () => {
  it('maps a repuesto doc into the row shape', () => {
    const rep = {
      nombre: 'Sensor O2',
      CantidadInstalacion: 2,
      EquipoId: { item: 'Monitor' },
      EstadoSolicitud: 'Instalado',
      PrecioRepuesto: 100000,
      FechaSolicitud: '2026-07-01T00:00:00.000Z',
      FechaInstalacion: '2026-07-05T00:00:00.000Z',
      observacion: 'cambio preventivo',
    };
    const row = toRepuestoRow(rep);
    assert.equal(row.nombre, 'Sensor O2');
    assert.equal(row.cantidad, 2);
    assert.equal(row.equipo, 'Monitor');
    assert.equal(row.estado, 'Instalado');
    assert.equal(row.precioUnitario, 100000);
    assert.equal(row.precioTotal, 200000);
    assert.equal(row.observacion, 'cambio preventivo');
  });
});

describe('toEquipoResumen', () => {
  it('aggregates reportsForEquipo + repuestosForEquipo into a summary', () => {
    const equipo = {
      _id: 'e1',
      ItemId: { Nombre: 'Monitor' },
      Marca: 'Philips',
      Serie: 'S1',
      Inventario: 'INV1',
      SedeId: { nombreSede: 'Sede A' },
      Servicio: { nombre: 'UCI' },
      mesesMtto: ['Enero'],
      EstadoOperativo: 'Operativo',
    };
    const reportsForEquipo = [
      { estado: 'Cerrado', fechaFinalizdo: new Date() },
      { estado: 'Abierto', fechaFinalizdo: null },
    ];
    const repuestosForEquipo = [
      { EstadoSolicitud: 'Instalado', PrecioRepuesto: 50000, CantidadInstalacion: 2 },
      { EstadoSolicitud: 'Solicitado', PrecioRepuesto: 30000, CantidadInstalacion: 1 },
    ];
    const resumen = toEquipoResumen(equipo, reportsForEquipo, repuestosForEquipo);
    assert.equal(resumen.equipoId, 'e1');
    assert.equal(resumen.nombre, 'Monitor');
    assert.equal(resumen.marca, 'Philips');
    assert.equal(resumen.sede, 'Sede A');
    assert.equal(resumen.servicio, 'UCI');
    assert.equal(resumen.totalProgramados, 1);
    assert.equal(resumen.totalRealizados, 1);
    assert.equal(resumen.cumplimiento, 50);
    assert.equal(resumen.costoRepuestos, 100000);
    assert.equal(resumen.estadoOperativo, 'Operativo');
  });
});
