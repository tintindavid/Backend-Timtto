'use strict';

/**
 * Shared primitives consumed by both `informeGenerate.service.js` (por-mes)
 * and `informeGenerateByOt.service.js` (por-ot). Extracted per
 * openspec/changes/informes-por-ot-tab-con-firma-y-cumplimiento, design.md
 * Decision 1/2.
 *
 * Two classification functions on purpose (design D2): each caller has its
 * own bucketing semantics and a single overloaded function would need a
 * per-caller mapping table anyway.
 */

// ─── Classifiers ─────────────────────────────────────────────────────────────

/**
 * Por-mes classification (current/legacy semantics, unchanged behavior).
 * @param {object} report
 * @returns {'Cancelado'|'Realizado'|'Programado'}
 */
export function classifyReportForMeses(report) {
  if (report.estado === 'Cancelado') return 'Cancelado';
  if (report.fechaFinalizdo) return 'Realizado';
  return 'Programado';
}

/**
 * Por-ot classification (new semantics, design D2/D3).
 * @param {object} report
 * @returns {'Cancelado'|'Cumplido'|'Pendiente'}
 */
export function classifyReportForOt(report) {
  if (report.estado === 'Cancelado') return 'Cancelado';
  if (['Cerrado', 'Procesado', 'Abierto'].includes(report.estado)) return 'Cumplido';
  return 'Pendiente';
}

// ─── Formatters / mappers ────────────────────────────────────────────────────

export function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CO', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export function toReportRow(report) {
  const snap = report.equipoSnapshot || {};
  const equipo = report.Equipo || {};
  return {
    consecutivo: report.consecutivo || report._id?.toString() || '',
    equipoNombre: snap.ItemText || equipo.item || '',
    marca: snap.Marca || equipo.Marca || '',
    serie: snap.Serie || equipo.Serie || '',
    sede: snap.Sede || '',
    servicio: snap.Servicio || '',
    tipoMtto: report.tipoMtto || 'Preventivo',
    estado: classifyReportForMeses(report),
    fechaProgramada: formatDate(report.FechaCreacion),
    fechaRealizado: formatDate(report.fechaProcesado),
    fechaCerrado: formatDate(report.fechaFinalizdo),
    tecnico: report.ResponsableMtto?.fullName || '',
    diagnostico: report.diagnostico || '',
    accionTomada: report.accionTomada || '',
    observacion: report.observacion || '',
    modelo: snap.Modelo || '',
    inventario: snap.Inventario || '',
    duracion: report.duracion ?? 45,
  };
}

export function toEquipoResumen(equipo, reportsForEquipo, repuestosForEquipo) {
  const programados = reportsForEquipo.filter(r => classifyReportForMeses(r) === 'Programado').length;
  const realizados  = reportsForEquipo.filter(r => classifyReportForMeses(r) === 'Realizado').length;
  const total       = programados + realizados;

  const costoRepuestos = repuestosForEquipo
    .filter(r => r.EstadoSolicitud === 'Instalado')
    .reduce((sum, r) => sum + ((r.PrecioRepuesto || 0) * (r.CantidadInstalacion || 1)), 0);

  return {
    equipoId: equipo._id?.toString(),
    nombre: equipo.ItemId?.Nombre || equipo.item || '',
    marca: equipo.Marca || '',
    serie: equipo.Serie || '',
    inventario: equipo.Inventario || '',
    sede: equipo.SedeId?.nombreSede || '',
    servicio: equipo.Servicio?.nombre || '',
    mesesMtto: equipo.mesesMtto || [],
    totalProgramados: programados,
    totalRealizados: realizados,
    cumplimiento: total > 0 ? Math.round((realizados / total) * 1000) / 10 : 0,
    estadoOperativo: equipo.EstadoOperativo || 'Operativo',
    costoRepuestos,
  };
}

export function toRepuestoRow(rep) {
  return {
    nombre: rep.nombre || '',
    cantidad: rep.Cantidad || rep.CantidadInstalacion || 0,
    equipo: rep.EquipoId?.item || rep.EquipoId?.Marca || '',
    estado: rep.EstadoSolicitud || '',
    precioUnitario: rep.PrecioRepuesto || 0,
    precioTotal: (rep.PrecioRepuesto || 0) * (rep.CantidadInstalacion || 1),
    fechaSolicitud: formatDate(rep.FechaSolicitud),
    fechaInstalacion: formatDate(rep.FechaInstalacion),
    observacion: rep.observacion || '',
  };
}
