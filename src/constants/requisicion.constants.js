'use strict';

/**
 * Requisiciones constants (change: requisiciones-e1-base-aprobacion).
 *
 * Single source of truth for states, timeline events, approval levels and numbering referenced by the models,
 * services, DTOs and tests. The state enum is ADDITIVE: later epics append states (Revision_Almacen, En_Licitacion...)
 * without reordering these.
 */

export const REQUISICION_ESTADO = Object.freeze({
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  EN_APROBACION: 'En_Aprobacion',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  CANCELADA: 'Cancelada',
});
export const REQUISICION_ESTADO_VALUES = Object.freeze(Object.values(REQUISICION_ESTADO));

/** Terminal states: nothing leaves them. (`Aprobada` ends the E1 flow but later epics continue from it.) */
export const REQUISICION_ESTADOS_TERMINALES = Object.freeze([REQUISICION_ESTADO.CANCELADA]);

/** Transition table of E1: `from -> allowed destinations`. Cancelada is reachable from every non-terminal state. */
export const REQUISICION_TRANSICIONES = Object.freeze({
  [REQUISICION_ESTADO.BORRADOR]: Object.freeze([REQUISICION_ESTADO.ENVIADA, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.ENVIADA]: Object.freeze([REQUISICION_ESTADO.EN_APROBACION, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.EN_APROBACION]: Object.freeze([
    REQUISICION_ESTADO.APROBADA,
    REQUISICION_ESTADO.RECHAZADA,
    REQUISICION_ESTADO.BORRADOR,
    REQUISICION_ESTADO.CANCELADA,
  ]),
  [REQUISICION_ESTADO.APROBADA]: Object.freeze([REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.RECHAZADA]: Object.freeze([REQUISICION_ESTADO.BORRADOR, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.CANCELADA]: Object.freeze([]),
});

/** States whose estimated amount counts as CONSUMED / COMMITTED in the (informative) area budget. */
export const PRESUPUESTO_ESTADOS_CONSUMIDO = Object.freeze([REQUISICION_ESTADO.APROBADA]);
export const PRESUPUESTO_ESTADOS_COMPROMETIDO = Object.freeze([REQUISICION_ESTADO.ENVIADA, REQUISICION_ESTADO.EN_APROBACION]);

export const REQUISICION_EVENTO = Object.freeze({
  CREADA: 'CREADA',
  EDITADA: 'EDITADA',
  ENVIADA: 'ENVIADA',
  APROBACION_SOLICITADA: 'APROBACION_SOLICITADA',
  NIVEL_APROBADO: 'NIVEL_APROBADO',
  NIVEL_RECHAZADO: 'NIVEL_RECHAZADO',
  APROBADA: 'APROBADA',
  RECHAZADA: 'RECHAZADA',
  RETIRADA: 'RETIRADA',
  REABIERTA: 'REABIERTA',
  CANCELADA: 'CANCELADA',
  APROBADORES_REASIGNADOS: 'APROBADORES_REASIGNADOS',
  ELIMINADA: 'ELIMINADA',
});
export const REQUISICION_EVENTO_VALUES = Object.freeze(Object.values(REQUISICION_EVENTO));

export const TIMELINE_ACTOR_TIPO = Object.freeze({ USUARIO: 'usuario', SISTEMA: 'sistema' });
export const TIMELINE_ACTOR_TIPO_VALUES = Object.freeze(Object.values(TIMELINE_ACTOR_TIPO));
/** Soft cap of timeline entries per requisition (design D3). */
export const TIMELINE_SOFT_CAP = 500;

export const NIVEL_ESTADO = Object.freeze({
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  CANCELADO: 'Cancelado',
});
export const NIVEL_ESTADO_VALUES = Object.freeze(Object.values(NIVEL_ESTADO));

export const APROBADOR_TIPO = Object.freeze({
  JEFE_AREA: 'jefe_area',
  ROL: 'rol',
  USUARIOS: 'usuarios',
});
export const APROBADOR_TIPO_VALUES = Object.freeze(Object.values(APROBADOR_TIPO));

export const LINEA_ESTADO = Object.freeze({ PENDIENTE: 'Pendiente', CANCELADA: 'Cancelada' });
export const LINEA_ESTADO_VALUES = Object.freeze(Object.values(LINEA_ESTADO));

export const REQUISICION_PRIORIDAD = Object.freeze({ BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', URGENTE: 'Urgente' });
export const REQUISICION_PRIORIDAD_VALUES = Object.freeze(Object.values(REQUISICION_PRIORIDAD));

export const ABASTECIMIENTO_MODO_VALUES = Object.freeze(['almacen', 'compra', 'mixto']);

/** Numbering: REQ-{YYYY}-{NNNN}, yearly counter key `requisiciones:{YYYY}` (year in America/Bogota). */
export const REQUISICION_CONSECUTIVO_PREFIX = 'REQ';
export const REQUISICION_CONSECUTIVO_PAD = 4;
export const REQUISICION_COUNTER_KEY = (year) => `requisiciones:${year}`;

export const REQUISICION_TIMEZONE = 'America/Bogota';
/** Colombia has no daylight saving time, so a fixed offset is exact. */
export const REQUISICION_TZ_OFFSET = '-05:00';
export const DEFAULT_CURRENCY = 'COP';

/** Whitelisted sort keys of GET /requisiciones. */
export const REQUISICION_SORT_FIELDS = Object.freeze(['createdAt', 'consecutivo', 'montoEstimado', 'estado', 'titulo']);

export const REQUISICION_MAX_LINEAS = 100;
export const AREA_MAX_JEFES = 10;
export const DEFAULT_ALERT_THRESHOLD = 80;

/** Period of a budget: year `YYYY` or month `YYYY-MM`. */
export const PERIODO_REGEX = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/** Default request types seeded per tenant (idempotent). */
export const DEFAULT_TIPOS_REQUISICION = Object.freeze([
  Object.freeze({ codigo: 'GENERAL', nombre: 'General' }),
  Object.freeze({ codigo: 'REPUESTO', nombre: 'Repuestos' }),
  Object.freeze({ codigo: 'PAPELERIA', nombre: 'Papelería' }),
  Object.freeze({ codigo: 'SERVICIO', nombre: 'Servicios' }),
]);
export const DEFAULT_AREA = Object.freeze({ codigo: 'GENERAL', nombre: 'General' });
export const DEFAULT_REGLA = Object.freeze({
  orden: 1,
  nombre: 'Jefe de área',
  montoDesde: 0,
  montoHasta: null,
  aprobadorTipo: 'jefe_area',
});
