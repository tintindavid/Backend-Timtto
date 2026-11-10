import {
  DIAS_ALERTA_LICITACION,
  DIAS_SIN_MOVIMIENTO,
  ENTREGA_ESTADO,
  LINEA_ESTADO,
  REQUISICION_ESTADO,
} from '../constants/requisicion.constants.js';

/**
 * Tenant-wide pending predicates (change: requisiciones-e5-reporteria). Each predicate is defined ONCE here and used by BOTH
 * the dashboard's tenant facet (`$match`) and the list (`GET /requisiciones?alcance=tenant&filtro=<name>`), so a counter and
 * its list can never diverge. A predicate is a plain Mongo match (valid in `find`, `countDocuments` and `$match`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** States that never count as pending work (no movement / deliverables alerts). */
export const ESTADOS_INACTIVOS = Object.freeze([
  REQUISICION_ESTADO.BORRADOR,
  REQUISICION_ESTADO.RECHAZADA,
  REQUISICION_ESTADO.CERRADA,
  REQUISICION_ESTADO.CANCELADA,
]);

const RECIBIR_ESTADOS = [REQUISICION_ESTADO.APROBADA, REQUISICION_ESTADO.OC_ENVIADA, REQUISICION_ESTADO.EN_RECEPCION];
const LINEAS_POR_RECIBIR = [LINEA_ESTADO.PENDIENTE, LINEA_ESTADO.RECIBIDA_PARCIAL, LINEA_ESTADO.EN_DISPUTA];

/** Whitelist of the `filtro` query parameter. */
export const FILTROS_TENANT = Object.freeze([
  'licitaciones-abiertas',
  'licitaciones-por-vencer',
  'licitaciones-vencidas',
  'oc-por-aprobar',
  'por-recibir',
  'por-confirmar',
  'entregables-pendientes',
  'sin-movimiento',
]);

/** @returns {object|null} the Mongo match of `filtro`, or null when unknown */
export function tenantFilterMatch(filtro, now = new Date()) {
  switch (filtro) {
    case 'licitaciones-abiertas':
      return { estado: REQUISICION_ESTADO.EN_LICITACION };
    case 'licitaciones-por-vencer':
      return {
        estado: REQUISICION_ESTADO.EN_LICITACION,
        'licitacion.fechaLimiteCotizacion': { $gte: now, $lte: new Date(now.getTime() + DIAS_ALERTA_LICITACION * DAY_MS) },
      };
    case 'licitaciones-vencidas':
      return { estado: REQUISICION_ESTADO.EN_LICITACION, 'licitacion.fechaLimiteCotizacion': { $lt: now } };
    case 'oc-por-aprobar':
      return { estado: { $in: [REQUISICION_ESTADO.OC_EMITIDA, REQUISICION_ESTADO.OC_EN_REAPROBACION] } };
    case 'por-recibir':
      return { estado: { $in: RECIBIR_ESTADOS }, lineas: { $elemMatch: { estadoLinea: { $in: LINEAS_POR_RECIBIR } } } };
    case 'por-confirmar':
      return {
        estado: REQUISICION_ESTADO.EN_RECEPCION,
        recepciones: { $elemMatch: { items: { $elemMatch: { confirmacion: { $exists: false } } } } },
      };
    case 'entregables-pendientes':
      return {
        estado: { $nin: [...ESTADOS_INACTIVOS] },
        'ordenCompra.entrega.estado': { $in: [ENTREGA_ESTADO.EN_REVISION, ENTREGA_ESTADO.DEVOLUCION] },
      };
    case 'sin-movimiento':
      return {
        estado: { $nin: [...ESTADOS_INACTIVOS] },
        $expr: { $lt: [{ $ifNull: [{ $max: '$timeline.fecha' }, '$createdAt'] }, new Date(now.getTime() - DIAS_SIN_MOVIMIENTO * DAY_MS)] },
      };
    default:
      return null;
  }
}

/** Early `$match` of the tenant facet: only states that can belong to some counter (terminal documents are never loaded). */
export const FACET_PRE_MATCH = Object.freeze({ estado: { $nin: [...ESTADOS_INACTIVOS] } });

/** Early `$project` of the facet: only the fields the predicates read. */
export const FACET_PROJECT = Object.freeze({
  estado: 1,
  createdAt: 1,
  'licitacion.fechaLimiteCotizacion': 1,
  'lineas.estadoLinea': 1,
  'recepciones.items.confirmacion.resultado': 1,
  'ordenCompra.entrega.estado': 1,
  'timeline.fecha': 1,
});
