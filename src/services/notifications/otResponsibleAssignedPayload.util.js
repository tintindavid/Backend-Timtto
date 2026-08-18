'use strict';

/**
 * Builds the uniform `ot.responsible.assigned` payload (design.md D10/D11,
 * ot-responsables-programacion-trazable). One payload is shared across every
 * `notificationService.emit(...)` call for a given programación write — only
 * the recipient (per-userId emit, design D10) varies.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.otId
 * @param {string} params.otConsecutivo
 * @param {string} params.customerName
 * @param {Date|string} params.fechaInicio
 * @param {Date|string} params.fechaFin
 * @returns {{otId: string, otConsecutivo: string, customerName: string, fechaInicio: string, fechaFin: string, title: string, body: string, data: {link: string}}}
 */
export function buildOtResponsibleAssignedPayload({ otId, otConsecutivo, customerName, fechaInicio, fechaFin }) {
  const consecutivo = otConsecutivo || '';
  const cliente = customerName || 'Cliente';
  const fmt = (d) => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };
  const fechaInicioFmt = fmt(fechaInicio);
  const fechaFinFmt = fmt(fechaFin);

  return {
    otId: otId != null ? String(otId) : null,
    otConsecutivo: consecutivo,
    customerName: cliente,
    fechaInicio: fechaInicioFmt,
    fechaFin: fechaFinFmt,
    title: 'Nueva OT asignada',
    body: `OT ${consecutivo} · ${cliente} · ${fechaInicioFmt} → ${fechaFinFmt}`,
    // Deep-link opens /maintenance-orders and auto-opens OtQuickDetailModal
    // for this OT (design D11) — same `?param` mechanism as `?preview_sheet`.
    data: { link: `/maintenance-orders?open_ot=${otId}` },
  };
}
