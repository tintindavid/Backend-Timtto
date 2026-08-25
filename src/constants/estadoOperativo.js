'use strict';

/**
 * Single source of truth for the operational-state enum shared by
 * `EquipoItem.EstadoOperativo`, `Report.EstadoOperativo`, and every history
 * entry appended via `equipoItemService._appendEstadoOperativoHistory`
 * (openspec/changes/equipo-estado-operativo-editable-y-cronograma-excel).
 *
 * Do NOT redeclare this enum inline anywhere else — import it.
 */
export const EstadoOperativoValues = [
  'Operativo',
  'Fuera de Servicio',
  'En Mantenimiento',
  'Espera de Repuestos',
  'En Reparacion',
];

export const EstadoOperativoDefault = 'Operativo';

/**
 * Origin of an `estadoOperativoHistory[]` entry — who/what triggered the
 * transition. See design.md D2/D3.
 */
export const EstadoOperativoSources = [
  'manual',
  'report-close',
  'bulk-upload',
  'migration',
];
