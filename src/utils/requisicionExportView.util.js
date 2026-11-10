import { hasOrdenCompraPermission } from './requisicionQuoteVisibility.util.js';

/**
 * View model of the single-requisition exports (PDF and Excel; change: requisiciones-e5-reporteria, tasks 2.1 / 2.3).
 * It is built ONLY from the DTO the detail screen returns AFTER the quote / purchase-order redaction (never from the stored
 * document), and it carries an explicit `canSeePrices` switch: without it no amount, no purchase order, no deliverable and no
 * quotation reaches the view, so neither renderer can leak one. File URLs and tokens are never copied (names only).
 */

const idOf = (v) => (v === null || v === undefined ? '' : String(v?._id ?? v));
const nameOf = (u) => {
  if (!u) return null;
  if (typeof u !== 'object') return null;
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null;
};

/** Who may see amounts in an export: the purchasing permissions (same rule as the purchase order) or the creator. */
export function canSeePricesFor(user, dto) {
  if (!user) return false;
  return hasOrdenCompraPermission(user) || (Boolean(user.userId) && idOf(dto?.creadaPor) === String(user.userId));
}

export const EVENTO_LABEL = Object.freeze({
  CREADA: 'Creada', EDITADA: 'Editada', ENVIADA: 'Enviada a aprobación', APROBACION_SOLICITADA: 'Aprobación solicitada',
  NIVEL_APROBADO: 'Nivel aprobado', NIVEL_RECHAZADO: 'Nivel rechazado', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada',
  RETIRADA: 'Retirada', REABIERTA: 'Reabierta', CANCELADA: 'Cancelada', APROBADORES_REASIGNADOS: 'Aprobadores reasignados',
  ELIMINADA: 'Eliminada', RECEPCION_REGISTRADA: 'Recepción registrada', ENTREGA_CONFIRMADA: 'Entrega confirmada',
  ENTREGA_DISPUTADA: 'Entrega en disputa', LINEA_CERRADA: 'Línea cerrada', LINEA_CANCELADA: 'Línea cancelada', CERRADA: 'Cerrada',
  PROVEEDOR_ASIGNADO: 'Proveedor asignado', PROVEEDOR_QUITADO: 'Proveedor retirado', LICITACION_INICIADA: 'Licitación iniciada',
  INVITACIONES_ENVIADAS: 'Invitaciones enviadas', INVITACION_ACEPTADA: 'Invitación aceptada', INVITACION_RECHAZADA: 'Invitación rechazada',
  COTIZACIONES_CERRADAS: 'Cotizaciones cerradas', PROVEEDOR_SELECCIONADO: 'Proveedor seleccionado', PROVEEDOR_DESCARTADO: 'Proveedor descartado',
  COMPRA_DIRECTA_JUSTIFICADA: 'Compra directa justificada', FECHA_LIMITE_AMPLIADA: 'Fecha límite ampliada',
  RECORDATORIO_ENVIADO: 'Recordatorio enviado', COTIZACION_RECIBIDA: 'Cotización recibida',
  OC_EMITIDA: 'Orden de compra emitida', OC_EDITADA: 'Orden de compra editada', OC_REAPROBACION_REQUERIDA: 'Reaprobación de la orden requerida',
  OC_APROBADA: 'Orden de compra aprobada', OC_RECHAZADA: 'Orden de compra rechazada', OC_ENVIADA: 'Orden de compra enviada',
  OC_REENVIADA: 'Orden de compra reenviada', ENTREGABLES_RECIBIDOS: 'Entregables recibidos', PASO_REVISION_ENTREGA: 'Entregables en revisión',
  DEVUELTA: 'Entregables devueltos', ENTREGABLES_ACEPTADOS: 'Entregables aceptados',
});

/** Events that disclose quotations, the purchase order or its deliverables: omitted for who cannot see prices. */
const PRICE_EVENT = /^(OC_|ENTREGABLES_)|^(PASO_REVISION_ENTREGA|DEVUELTA|COTIZACION_RECIBIDA)$/;

const actorName = (e) => {
  const a = e?.actor || {};
  if (a.tipo === 'sistema') return 'Sistema';
  if (a.tipo === 'proveedor') return a.nombreExterno || 'Proveedor';
  return nameOf(a.usuarioId) || 'Usuario';
};

/**
 * @param {object} dto  requisition as the detail returns it, already redacted for the viewer
 * @param {{ canSeePrices: boolean, tenantNombre?: string, generadoEn?: Date }} ctx
 */
export function buildRequisicionView(dto, { canSeePrices = false, tenantNombre = '', generadoEn = new Date() } = {}) {
  const lineas = Array.isArray(dto.lineas) ? dto.lineas : [];
  const lineaDesc = new Map(lineas.map((l) => [idOf(l.lineaId ?? l._id), l.descripcion]));
  const oc = canSeePrices && dto.ordenCompra?.numero ? dto.ordenCompra : null;
  const ganador = (dto.licitacion?.proveedores || []).find((p) => idOf(p._id) === idOf(dto.licitacion?.ganadorId));

  const view = {
    consecutivo: dto.consecutivo,
    titulo: dto.titulo,
    tenantNombre,
    generadoEn,
    canSeePrices: Boolean(canSeePrices),
    moneda: dto.moneda || null,
    resumen: [
      ['Consecutivo', dto.consecutivo],
      ['Título', dto.titulo],
      ['Estado', dto.estado],
      ['Tipo', dto.tipoRequisicionId?.nombre ?? null],
      ['Área', dto.areaId?.nombre ?? null],
      ['Solicitante', nameOf(dto.solicitanteId)],
      ['Creada por', nameOf(dto.creadaPor)],
      ['Prioridad', dto.prioridad ?? null],
      ['Fecha de creación', dto.createdAt ? new Date(dto.createdAt) : null],
      ['Fecha requerida', dto.fechaRequerida ? new Date(dto.fechaRequerida) : null],
      ['Justificación', dto.justificacion ?? null],
    ],
    lineas: lineas.map((l, i) => ({
      n: i + 1,
      descripcion: l.descripcion ?? null,
      especificaciones: l.especificaciones ?? null,
      unidad: l.unidad ?? null,
      cantidad: Number(l.cantidadSolicitada) || 0,
      estado: l.estadoLinea ?? null,
      precio: canSeePrices ? Number(l.precioEstimado) || 0 : null,
      subtotal: canSeePrices ? (Number(l.cantidadSolicitada) || 0) * (Number(l.precioEstimado) || 0) : null,
    })),
    totalEstimado: canSeePrices ? Number(dto.montoEstimado) || 0 : null,
    aprobacion: (dto.aprobacion?.niveles || []).map((n) => ({
      orden: n.orden,
      nombre: n.nombre ?? null,
      estado: n.estado ?? null,
      decididoPor: nameOf(n.decididoPor),
      fecha: n.fecha ? new Date(n.fecha) : null,
      observacion: n.observacion ?? null,
    })),
    recepciones: (dto.recepciones || []).map((r) => ({
      fecha: r.fecha ? new Date(r.fecha) : null,
      recibidaPor: nameOf(r.recibidaPor),
      documento: r.documento ?? null,
      observacion: r.observacion ?? null,
      items: (r.items || []).map((it) => ({
        descripcion: lineaDesc.get(idOf(it.lineaId)) ?? null,
        cantidad: Number(it.cantidadRecibida) || 0,
        confirmacion: it.confirmacion
          ? { resultado: it.confirmacion.resultado ?? null, cantidad: it.confirmacion.cantidad ?? null, por: nameOf(it.confirmacion.por), observacion: it.confirmacion.observacion ?? null }
          : null,
      })),
    })),
    ordenCompra: oc
      ? {
        numero: oc.numero,
        estado: oc.estado ?? null,
        proveedor: ganador?.nombre ?? null,
        total: oc.total ?? null,
        moneda: oc.moneda ?? null,
        fechaEntrega: oc.fechaEntrega ? new Date(oc.fechaEntrega) : null,
        entregables: (oc.entrega?.archivos || []).map((a) => a?.nombre).filter(Boolean),
      }
      : null,
    historial: (Array.isArray(dto.timeline) ? dto.timeline : [])
      .filter((e) => canSeePrices || !PRICE_EVENT.test(String(e?.tipo)))
      .map((e) => ({
        fecha: e.fecha ? new Date(e.fecha) : null,
        evento: EVENTO_LABEL[e.tipo] || String(e.tipo || '').replace(/_/g, ' ').toLowerCase(),
        actor: actorName(e),
        estado: e.estadoNuevo ?? null,
        observacion: e.observacion ?? null,
      })),
  };
  return view;
}
