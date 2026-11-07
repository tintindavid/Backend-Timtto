/**
 * Output of the PUBLIC supplier portal (E3). Built FIELD BY FIELD (allowlist) from a projection that already holds only
 * what the supplier may see: the requisition header, the lines WITHOUT prices, and the supplier's OWN entry. Never
 * returns prices, amounts, area, requester, approvers, timeline, other suppliers, the token hash nor the access log.
 */

import { toPortalOrdenCompra } from './requisicionOrdenCompraDto.util.js';

/** The supplier's own quotation as shown back to him (no internal `origen` / `registradaPor`). */
export function toPortalCotizacion(c) {
  if (!c) return null;
  const a = c.archivo || {};
  return {
    archivo: a.url ? { url: a.url, nombre: a.nombre ?? null, tipo: a.tipo ?? null, tamano: a.tamano ?? null } : null,
    linkPropuesta: c.linkPropuesta ?? null,
    observacion: c.observacion ?? null,
    valorTotal: c.valorTotal ?? null,
    moneda: c.moneda ?? null,
    tiempoEntregaDias: c.tiempoEntregaDias ?? null,
    fechaRespuesta: c.fechaRespuesta ?? null,
  };
}

/**
 * @param {{ consecutivo, titulo, instrucciones, fechaLimiteCotizacion, items: object[] }} view  header + lines (projection)
 * @param {{ estadoEnvio: string, cotizacion?: object }} proveedor  the supplier's own entry
 * @param {{ tenantNombre: string, cerrada: boolean }} ctx
 */
export function toPortalDto(view, proveedor, { tenantNombre, cerrada }) {
  return {
    tenantNombre: tenantNombre ?? null,
    consecutivo: view.consecutivo ?? null,
    titulo: view.titulo ?? null,
    instrucciones: view.instrucciones || null,
    fechaLimiteCotizacion: view.fechaLimiteCotizacion ?? null,
    items: (view.items || []).map((i) => ({
      descripcion: i.descripcion ?? null,
      cantidad: i.cantidad ?? null,
      unidad: i.unidad ?? null,
      especificacion: i.especificacion ?? null,
    })),
    estadoEnvio: proveedor.estadoEnvio,
    cotizacion: toPortalCotizacion(proveedor.cotizacion),
    cerrada: Boolean(cerrada),
    // E4: present only for the winner and only once the OC was sent (the projection already drops it otherwise).
    ...(view.ordenCompra ? { ordenCompra: toPortalOrdenCompra(view.ordenCompra) } : {}),
  };
}
