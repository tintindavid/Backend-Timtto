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
  // E3 (requisiciones-e3-compras-portal): optional tendering with suppliers and award.
  EN_LICITACION: 'En_Licitacion',
  COTIZACION_RECIBIDA: 'Cotizacion_Recibida',
  ADJUDICADA: 'Adjudicada',
  // E4 (requisiciones-e4-oc-recepcion): purchase order (OC) of the winning supplier.
  OC_EMITIDA: 'OC_Emitida',
  OC_EN_REAPROBACION: 'OC_En_Reaprobacion',
  OC_APROBADA: 'OC_Aprobada',
  OC_ENVIADA: 'OC_Enviada',
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
  // E3: Aprobada -> En_Licitacion (open the tender) | Adjudicada (justified direct purchase). Tendering is optional.
  [REQUISICION_ESTADO.APROBADA]: Object.freeze([
    REQUISICION_ESTADO.EN_LICITACION,
    REQUISICION_ESTADO.ADJUDICADA,
    REQUISICION_ESTADO.EN_RECEPCION,
    REQUISICION_ESTADO.CERRADA,
    REQUISICION_ESTADO.CANCELADA,
  ]),
  [REQUISICION_ESTADO.EN_LICITACION]: Object.freeze([REQUISICION_ESTADO.COTIZACION_RECIBIDA, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.COTIZACION_RECIBIDA]: Object.freeze([REQUISICION_ESTADO.ADJUDICADA, REQUISICION_ESTADO.CANCELADA]),
  // E4: the awarded goods are received only after the purchase order was sent (`Adjudicada -> En_Recepcion` no longer exists).
  [REQUISICION_ESTADO.ADJUDICADA]: Object.freeze([
    REQUISICION_ESTADO.OC_EMITIDA,
    REQUISICION_ESTADO.CERRADA,
    REQUISICION_ESTADO.CANCELADA,
  ]),
  [REQUISICION_ESTADO.OC_EMITIDA]: Object.freeze([
    REQUISICION_ESTADO.OC_APROBADA,
    REQUISICION_ESTADO.OC_EN_REAPROBACION,
    REQUISICION_ESTADO.ADJUDICADA,
    REQUISICION_ESTADO.CANCELADA,
  ]),
  [REQUISICION_ESTADO.OC_EN_REAPROBACION]: Object.freeze([
    REQUISICION_ESTADO.OC_APROBADA,
    REQUISICION_ESTADO.OC_EMITIDA,
    REQUISICION_ESTADO.CANCELADA,
  ]),
  [REQUISICION_ESTADO.OC_APROBADA]: Object.freeze([REQUISICION_ESTADO.OC_ENVIADA, REQUISICION_ESTADO.CANCELADA]),
  [REQUISICION_ESTADO.OC_ENVIADA]: Object.freeze([
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
  REQUISICION_ESTADO.EN_LICITACION,
  REQUISICION_ESTADO.COTIZACION_RECIBIDA,
  REQUISICION_ESTADO.ADJUDICADA,
  REQUISICION_ESTADO.OC_EMITIDA,
  REQUISICION_ESTADO.OC_EN_REAPROBACION,
  REQUISICION_ESTADO.OC_APROBADA,
  REQUISICION_ESTADO.OC_ENVIADA,
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
  // E3: tendering and award.
  PROVEEDOR_ASIGNADO: 'PROVEEDOR_ASIGNADO',
  PROVEEDOR_QUITADO: 'PROVEEDOR_QUITADO',
  LICITACION_INICIADA: 'LICITACION_INICIADA',
  INVITACIONES_ENVIADAS: 'INVITACIONES_ENVIADAS',
  INVITACION_ACEPTADA: 'INVITACION_ACEPTADA',
  INVITACION_RECHAZADA: 'INVITACION_RECHAZADA',
  COTIZACION_RECIBIDA: 'COTIZACION_RECIBIDA',
  COTIZACIONES_CERRADAS: 'COTIZACIONES_CERRADAS',
  PROVEEDOR_SELECCIONADO: 'PROVEEDOR_SELECCIONADO',
  PROVEEDOR_DESCARTADO: 'PROVEEDOR_DESCARTADO',
  COMPRA_DIRECTA_JUSTIFICADA: 'COMPRA_DIRECTA_JUSTIFICADA',
  FECHA_LIMITE_AMPLIADA: 'FECHA_LIMITE_AMPLIADA',
  // E4: purchase order and supplier deliverables.
  OC_EMITIDA: 'OC_EMITIDA',
  OC_EDITADA: 'OC_EDITADA',
  OC_REAPROBACION_REQUERIDA: 'OC_REAPROBACION_REQUERIDA',
  OC_APROBADA: 'OC_APROBADA',
  OC_RECHAZADA: 'OC_RECHAZADA',
  OC_ENVIADA: 'OC_ENVIADA',
  OC_REENVIADA: 'OC_REENVIADA',
  ENTREGABLES_RECIBIDOS: 'ENTREGABLES_RECIBIDOS',
  PASO_REVISION_ENTREGA: 'PASO_REVISION_ENTREGA',
  DEVUELTA: 'DEVUELTA',
  ENTREGABLES_ACEPTADOS: 'ENTREGABLES_ACEPTADOS',
  RECORDATORIO_ENVIADO: 'RECORDATORIO_ENVIADO',
});
export const REQUISICION_EVENTO_VALUES = Object.freeze(Object.values(REQUISICION_EVENTO));

export const TIMELINE_ACTOR_TIPO = Object.freeze({ USUARIO: 'usuario', SISTEMA: 'sistema', PROVEEDOR: 'proveedor' });
export const TIMELINE_ACTOR_TIPO_VALUES = Object.freeze(Object.values(TIMELINE_ACTOR_TIPO));
/**
 * "Mi historial": action filter -> timeline events the caller authored (change: requisiciones-mi-historial). Only events whose
 * actor is a user count (never system / supplier). `todo` is the union.
 */
export const REQUISICION_ACCIONES_HISTORIAL = Object.freeze({
  aprobe: Object.freeze([REQUISICION_EVENTO.NIVEL_APROBADO]),
  rechace: Object.freeze([REQUISICION_EVENTO.NIVEL_RECHAZADO, REQUISICION_EVENTO.RECHAZADA]),
  recibi: Object.freeze([REQUISICION_EVENTO.RECEPCION_REGISTRADA]),
  confirme: Object.freeze([REQUISICION_EVENTO.ENTREGA_CONFIRMADA, REQUISICION_EVENTO.ENTREGA_DISPUTADA]),
  cree: Object.freeze([REQUISICION_EVENTO.CREADA]),
  adjudique: Object.freeze([REQUISICION_EVENTO.PROVEEDOR_SELECCIONADO, REQUISICION_EVENTO.COMPRA_DIRECTA_JUSTIFICADA]),
  // E5: purchase order events.
  emiti: Object.freeze([REQUISICION_EVENTO.OC_EMITIDA, REQUISICION_EVENTO.OC_EDITADA]),
  'aprobe-oc': Object.freeze([REQUISICION_EVENTO.OC_APROBADA, REQUISICION_EVENTO.OC_RECHAZADA]),
});
export const REQUISICION_ACCIONES_HISTORIAL_VALUES = Object.freeze(['todo', ...Object.keys(REQUISICION_ACCIONES_HISTORIAL)]);
/** Max own events returned per row in `miActividad`. */
export const REQUISICION_MI_ACTIVIDAD_MAX = 5;

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

// --- E3: tendering (licitacion) ---------------------------------------------------------------------------------

/** Per-supplier delivery/answer state of an invitation. `Descartado`/`Rechazado`/`Ganador` are terminal. */
export const PROVEEDOR_ESTADO_ENVIO = Object.freeze({
  PENDIENTE: 'Pendiente',
  ENVIADO: 'Enviado',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  GANADOR: 'Ganador',
  DESCARTADO: 'Descartado',
});
export const PROVEEDOR_ESTADO_ENVIO_VALUES = Object.freeze(Object.values(PROVEEDOR_ESTADO_ENVIO));
/** Suppliers that still count in the tender (neither refused nor discarded). */
export const PROVEEDOR_ESTADOS_ACTIVOS = Object.freeze([
  PROVEEDOR_ESTADO_ENVIO.PENDIENTE,
  PROVEEDOR_ESTADO_ENVIO.ENVIADO,
  PROVEEDOR_ESTADO_ENVIO.ACEPTADO,
]);
/** States in which the supplier portal link is still usable (before the deadline and while the tender is open). */
export const PROVEEDOR_ESTADOS_PORTAL = Object.freeze([PROVEEDOR_ESTADO_ENVIO.ENVIADO, PROVEEDOR_ESTADO_ENVIO.ACEPTADO]);

export const COTIZACION_ORIGEN = Object.freeze({ PORTAL: 'portal', INTERNO: 'interno' });
export const COTIZACION_ORIGEN_VALUES = Object.freeze(Object.values(COTIZACION_ORIGEN));

export const LICITACION_MAX_PROVEEDORES = 25;
export const LICITACION_MIN_PROVEEDORES = 2;
export const LICITACION_MAX_VISTAS = 200;
/** Previous quotation submissions kept per supplier (the oldest one is dropped with its file). */
export const COTIZACION_MAX_VERSIONES = 10;
export const LICITACION_MAX_DIAS_LIMITE = 90;
export const COMPRA_DIRECTA_MIN_JUSTIFICACION = 20;
/** After the award / the close of the window the links that may still read their page last this many days. */
export const PROVEEDOR_ENLACE_POST_CIERRE_DIAS = 30;
/** Token: 32 random bytes (base64url); only the SHA-256 hash and the last 4 chars are stored. */
export const PROVEEDOR_TOKEN_BYTES = 32;
export const PROVEEDOR_TOKEN_HINT_LENGTH = 4;
/** Quotation file: one PDF/image of up to 5 MiB. */
export const COTIZACION_ARCHIVO_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const COTIZACION_ARCHIVO_MAX_BYTES = 5 * 1024 * 1024;

// --- E4: purchase order (OC) and deliverables -------------------------------------------------------------------

/** Sub-state of the OC block (the header `estado` is the source of truth for the flow). */
export const OC_ESTADO = Object.freeze({ EMITIDA: 'Emitida', EN_REAPROBACION: 'En_Reaprobacion', APROBADA: 'Aprobada', ENVIADA: 'Enviada' });
export const OC_ESTADO_VALUES = Object.freeze(Object.values(OC_ESTADO));
/** Header states in which the OC exists (it cannot be edited from any but `OC_Emitida`). */
export const OC_ESTADOS_CABECERA = Object.freeze([
  REQUISICION_ESTADO.OC_EMITIDA,
  REQUISICION_ESTADO.OC_EN_REAPROBACION,
  REQUISICION_ESTADO.OC_APROBADA,
  REQUISICION_ESTADO.OC_ENVIADA,
]);
/** Numbering: OC-{YYYY}-{NNNN}, yearly counter key `ordenes-compra:{YYYY}` (year in America/Bogota). */
export const OC_CONSECUTIVO_PREFIX = 'OC';
export const OC_CONSECUTIVO_PAD = 4;
export const OC_COUNTER_KEY = (year) => `ordenes-compra:${year}`;
/** Re-approval margin: the OC total may exceed the estimated amount by this percentage (tenant setting, 0-100). */
export const OC_MARGEN_REAPROBACION_DEFAULT = 10;
export const OC_CONDICIONES_MAX = 2000;
/** Mailing status of the OC sent to the winner. */
export const OC_CORREO_ESTADO = Object.freeze({ ENVIADO: 'Enviado', FALLIDO: 'Fallido', DESACTIVADO: 'Desactivado', SIN_CORREO: 'Sin_correo' });
export const OC_CORREO_ESTADO_VALUES = Object.freeze(Object.values(OC_CORREO_ESTADO));

/** Deliverables (supplier supports) sub-state of the OC. */
export const ENTREGA_ESTADO = Object.freeze({
  PENDIENTE: 'Pendiente',
  RECIBIDOS: 'Recibidos',
  EN_REVISION: 'En_Revision',
  DEVOLUCION: 'Devolucion',
  ACEPTADOS: 'Aceptados',
});
export const ENTREGA_ESTADO_VALUES = Object.freeze(Object.values(ENTREGA_ESTADO));
export const ENTREGA_ARCHIVO_ORIGEN = Object.freeze({ PROVEEDOR: 'proveedor', USUARIO: 'usuario' });
export const ENTREGA_ARCHIVO_ORIGEN_VALUES = Object.freeze(Object.values(ENTREGA_ARCHIVO_ORIGEN));
/** Files kept per delivery (every upload round adds to the list), and per request. */
export const ENTREGA_MAX_ARCHIVOS = 30;
export const ENTREGA_MAX_ARCHIVOS_POR_SUBIDA = 5;
/** Reminder thresholds (days) read from the environment by the reminders script. */
export const RECORDATORIO_DIAS_DEFAULT = 3;

/** Public portal: fixed (non-leaking) messages. */
export const PORTAL_MENSAJE_NO_ENCONTRADO = 'Enlace no encontrado';
export const PORTAL_MENSAJE_TOKEN_EXPIRADO = 'Gracias por tu interés, decidimos no continuar tu proceso.';
/** Public portal limiters: wide per IP, narrow per IP + token (both run before any database access). */
export const PORTAL_IP_WINDOW_MS = 60 * 1000;
export const PORTAL_IP_MAX = 100;
export const PORTAL_TOKEN_WINDOW_MS = 60 * 1000;
export const PORTAL_TOKEN_MAX = 20;

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

// --- E5: reporting and exports ----------------------------------------------------------------------------------

/** Max rows of the list Excel export (more -> 413 EXPORT_DEMASIADAS_FILAS). */
export const EXPORT_MAX_FILAS = 5000;
/** A tender whose deadline is within this many days counts as "about to expire". */
export const DIAS_ALERTA_LICITACION = 2;
/** A non-terminal requisition with no timeline event for more than this many days counts as "no movement". */
export const DIAS_SIN_MOVIMIENTO = 7;
/** Metrics range: default and maximum window in days. */
export const METRICAS_RANGO_DEFAULT_DIAS = 90;
export const METRICAS_RANGO_MAX_DIAS = 366;
/** Aggregations stop after this long (503 REPORTE_LENTO instead of hanging). */
export const REPORTE_MAX_TIME_MS = 10000;
export const METRICAS_TOP_N = 10;

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
