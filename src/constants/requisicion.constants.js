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
  // E2 (requisiciones-e2-solicitudes-recepcion): reception of the goods and satisfied delivery.
  EN_RECEPCION: 'En_Recepcion',
  CERRADA: 'Cerrada',
});
export const REQUISICION_ESTADO_VALUES = Object.freeze(Object.values(REQUISICION_ESTADO));

/** Terminal states: nothing leaves them. `Cerrada` = delivery completed to satisfaction (E2). */
export const REQUISICION_ESTADOS_TERMINALES = Object.freeze([REQUISICION_ESTADO.CANCELADA, REQUISICION_ESTADO.CERRADA]);

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
  // E2: Aprobada -> En_Recepcion (automatic on the first reception) | Cerrada (automatic when every active line is
  // confirmed or cancelled) | Cancelada.
  [REQUISICION_ESTADO.APROBADA]: Object.freeze([
    REQUISICION_ESTADO.EN_RECEPCION,
    REQUISICION_ESTADO.CERRADA,
    REQUISICION_ESTADO.CANCELADA,
  ]),
  [REQUISICION_ESTADO.EN_RECEPCION]: Object.freeze([REQUISICION_ESTADO.CERRADA, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.CERRADA]: Object.freeze([]),
  [REQUISICION_ESTADO.RECHAZADA]: Object.freeze([REQUISICION_ESTADO.BORRADOR, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.CANCELADA]: Object.freeze([]),
});

/** States whose estimated amount counts as CONSUMED / COMMITTED in the (informative) area budget. */
export const PRESUPUESTO_ESTADOS_CONSUMIDO = Object.freeze([
  REQUISICION_ESTADO.APROBADA,
  REQUISICION_ESTADO.EN_RECEPCION,
  REQUISICION_ESTADO.CERRADA,
]);
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
  // E2: reception and delivery confirmation.
  RECEPCION_REGISTRADA: 'RECEPCION_REGISTRADA',
  ENTREGA_CONFIRMADA: 'ENTREGA_CONFIRMADA',
  ENTREGA_DISPUTADA: 'ENTREGA_DISPUTADA',
  LINEA_CERRADA: 'LINEA_CERRADA',
  LINEA_CANCELADA: 'LINEA_CANCELADA',
  CERRADA: 'CERRADA',
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

export const LINEA_ESTADO = Object.freeze({
  PENDIENTE: 'Pendiente',
  RECIBIDA_PARCIAL: 'Recibida_Parcial',
  RECIBIDA: 'Recibida',
  CONFIRMADA: 'Confirmada',
  EN_DISPUTA: 'En_Disputa',
  CANCELADA: 'Cancelada',
});
export const LINEA_ESTADO_VALUES = Object.freeze(Object.values(LINEA_ESTADO));

/** Reception (E2): result of the requester's delivery confirmation, soft cap of receptions per requisition. */
export const CONFIRMACION_RESULTADO = Object.freeze({ RECIBIDO: 'Recibido', NO_LLEGO: 'No_Llego', INCOMPLETO: 'Incompleto' });
export const CONFIRMACION_RESULTADO_VALUES = Object.freeze(Object.values(CONFIRMACION_RESULTADO));
export const RECEPCIONES_SOFT_CAP = 200;

/**
 * `Repuestos.requisicion.disponibilidad` (E2): progress of a spare-part request inside its requisition. The E1 values
 * (En_Compra, En_Camino, Cancelada) are kept. `EstadoSolicitud` of the request is NEVER touched by the module.
 */
export const REPUESTO_DISPONIBILIDAD = Object.freeze({
  EN_REQUISICION: 'En_Requisicion',
  EN_APROBACION: 'En_Aprobacion',
  EN_COMPRA: 'En_Compra',
  EN_CAMINO: 'En_Camino',
  EN_ABASTECIMIENTO: 'En_Abastecimiento',
  RECIBIDA: 'Recibida',
  DISPONIBLE: 'Disponible',
  EN_DISPUTA: 'En_Disputa',
  CANCELADA: 'Cancelada',
});
export const REPUESTO_DISPONIBILIDAD_VALUES = Object.freeze(Object.values(REPUESTO_DISPONIBILIDAD));

/** Values of the `requisicionEstado` filter of GET /repuestos (`sin` = not linked, `con` = linked, or a disponibilidad). */
export const REPUESTO_REQUISICION_FILTER_VALUES = Object.freeze([
  'sin',
  'con',
  REPUESTO_DISPONIBILIDAD.EN_REQUISICION,
  REPUESTO_DISPONIBILIDAD.EN_APROBACION,
  REPUESTO_DISPONIBILIDAD.EN_ABASTECIMIENTO,
  REPUESTO_DISPONIBILIDAD.RECIBIDA,
  REPUESTO_DISPONIBILIDAD.DISPONIBLE,
  REPUESTO_DISPONIBILIDAD.EN_DISPUTA,
]);

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

/**
 * Default catalog seeded per tenant when the module is activated (change: requisiciones-datos-por-defecto-tenant).
 * Records created or adopted from it are flagged `esSistema` and protected (no delete / deactivate / rename).
 */
export const DEFAULT_TIPOS_REQUISICION = Object.freeze([
  Object.freeze({ codigo: 'GENERAL', nombre: 'General' }),
  Object.freeze({ codigo: 'REPUESTO', nombre: 'Repuestos' }),
  Object.freeze({ codigo: 'PAPELERIA', nombre: 'Papelería' }),
  Object.freeze({ codigo: 'SERVICIO', nombre: 'Servicios' }),
  Object.freeze({ codigo: 'INSUMO', nombre: 'Insumos' }),
  Object.freeze({ codigo: 'MANTENIMIENTO', nombre: 'Mantenimiento' }),
  Object.freeze({ codigo: 'EQUIPOS_ACTIVOS', nombre: 'Equipos y activos' }),
  Object.freeze({ codigo: 'TECNOLOGIA', nombre: 'Tecnología' }),
]);
/** Default areas (no heads: the tenant admin assigns them). The E1 area GENERAL is not part of the catalog. */
export const DEFAULT_AREAS = Object.freeze([
  Object.freeze({ codigo: 'ADMINISTRACION', nombre: 'Administración' }),
  Object.freeze({ codigo: 'COMPRAS', nombre: 'Compras' }),
  Object.freeze({ codigo: 'MANTENIMIENTO', nombre: 'Mantenimiento' }),
  Object.freeze({ codigo: 'OPERACIONES', nombre: 'Operaciones' }),
  Object.freeze({ codigo: 'CALIDAD', nombre: 'Calidad' }),
  Object.freeze({ codigo: 'TALENTO_HUMANO', nombre: 'Talento humano' }),
  Object.freeze({ codigo: 'TECNOLOGIA', nombre: 'Tecnología' }),
]);
export const DEFAULT_REGLA = Object.freeze({
  orden: 1,
  nombre: 'Jefe de área',
  montoDesde: 0,
  montoHasta: null,
  aprobadorTipo: 'jefe_area',
});
/** Example budget: area ADMINISTRACION, current calendar year (computed at seed time), editable amount. */
export const DEFAULT_PRESUPUESTO = Object.freeze({
  areaCodigo: 'ADMINISTRACION',
  monto: 10000000,
  moneda: DEFAULT_CURRENCY,
});
