'use strict';

/**
 * Payload builders for the `requisicion.*` notification events
 * (openspec/changes/requisiciones-e1-base-aprobacion). Same uniform shape as
 * otNoteAddedPayload.util.js: `{ ...ids, title, body, data: { link } }`.
 * The deep link points at the requisicion detail: `/requisiciones/:id`.
 *
 * @typedef {object} RequisicionPayloadParams
 * @property {string|import('mongoose').Types.ObjectId} requisicionId
 * @property {string} [consecutivo]  e.g. "REQ-2026-0001"
 * @property {string} [actorName]    display name of who triggered the transition
 * @property {number} [nivel]        approval level (level events only)
 * @property {string} [reason]       rejection/withdraw/cancel reason
 * @property {string} [descripcion]  line / spare-part description (E2 delivery events)
 * @property {string} [link]         overrides the deep link (E2: the "available" notice points at /repuestos/solicitados)
 */

function base({ requisicionId, consecutivo, nivel, link: linkOverride }) {
  const id = requisicionId != null ? String(requisicionId) : null;
  return {
    requisicionId: id,
    consecutivo: consecutivo || '',
    ...(nivel != null ? { nivel } : {}),
    link: linkOverride || (id ? `/requisiciones/${id}` : '/requisiciones'),
  };
}

function build(params, title, body) {
  const b = base(params);
  const { link, ...ids } = b;
  return { ...ids, title, body, data: { link, requisicionId: b.requisicionId } };
}

function label(p) {
  return p.consecutivo ? `Requisición ${p.consecutivo}` : 'Requisición';
}
function actor(p) {
  return p.actorName || 'Un usuario';
}
function withReason(text, p) {
  return p.reason ? `${text} Motivo: ${String(p.reason).slice(0, 200)}` : text;
}

export function buildRequisicionSubmittedPayload(p) {
  return build(p, `${label(p)} enviada`, `${actor(p)} envió la requisición a aprobación.`);
}

export function buildRequisicionApprovalRequestedPayload(p) {
  const lvl = p.nivel != null ? ` (nivel ${p.nivel})` : '';
  return build(p, `${label(p)} requiere tu aprobación`, `${actor(p)} envió la requisición; está pendiente de tu aprobación${lvl}.`);
}

export function buildRequisicionLevelApprovedPayload(p) {
  const lvl = p.nivel != null ? ` el nivel ${p.nivel}` : ' un nivel';
  return build(p, `${label(p)}: nivel aprobado`, `${actor(p)} aprobó${lvl} de la requisición.`);
}

export function buildRequisicionApprovedPayload(p) {
  return build(p, `${label(p)} aprobada`, 'La requisición fue aprobada.');
}

export function buildRequisicionRejectedPayload(p) {
  return build(p, `${label(p)} rechazada`, withReason(`${actor(p)} rechazó la requisición.`, p));
}

export function buildRequisicionWithdrawnPayload(p) {
  return build(p, `${label(p)} retirada`, withReason(`${actor(p)} retiró la requisición.`, p));
}

export function buildRequisicionCancelledPayload(p) {
  return build(p, `${label(p)} cancelada`, withReason(`${actor(p)} canceló la requisición.`, p));
}

// --- E2: reception, delivery confirmation and closure ----------------------------------------------------------

function item(p) {
  return p.descripcion ? ` (${String(p.descripcion).slice(0, 120)})` : '';
}

export function buildRequisicionDeliveryRegisteredPayload(p) {
  return build(p, `${label(p)}: entrega registrada`, `${actor(p)} registró la recepción de materiales${item(p)}. Confirma que lo recibiste.`);
}

export function buildRequisicionDeliveryConfirmedPayload(p) {
  const name = p.descripcion ? `: ${String(p.descripcion).slice(0, 120)}` : '';
  return build(
    { ...p, link: p.link || '/repuestos/solicitados' },
    `Repuesto disponible${name}`,
    `${label(p)}: la entrega fue confirmada. Ya puedes instalarlo / crear la OT.`,
  );
}

export function buildRequisicionDeliveryDisputedPayload(p) {
  return build(p, `${label(p)}: entrega en disputa`, withReason(`${actor(p)} reportó que la entrega no llegó o llegó incompleta${item(p)}.`, p));
}

export function buildRequisicionLineClosedPayload(p) {
  return build(p, `${label(p)}: línea cerrada`, withReason(`${actor(p)} cerró la línea${item(p)}.`, p));
}

export function buildRequisicionClosedPayload(p) {
  return build(p, `${label(p)} cerrada`, 'La requisición fue cerrada: todas las entregas quedaron confirmadas o canceladas.');
}

// --- E3: tendering --------------------------------------------------------------------------------------------

export function buildRequisicionRfqSentPayload(p) {
  const fallidos = Number(p.fallidos) || 0;
  const tail = fallidos > 0 ? ` ${fallidos} no se pudieron enviar: revisa la pestaña de licitación.` : '';
  return build(
    { ...p, link: p.link || `/requisiciones/${p.requisicionId}?tab=licitacion` },
    `${label(p)}: invitaciones enviadas`,
    `${actor(p)} abrió la licitación y envió ${Number(p.enviados) || 0} invitación(es) a proveedores.${tail}`,
  );
}

export function buildRequisicionQuoteReceivedPayload(p) {
  const who = p.proveedorNombre ? String(p.proveedorNombre).slice(0, 120) : 'Un proveedor';
  return build(
    { ...p, link: p.link || `/requisiciones/${p.requisicionId}?tab=licitacion` },
    `${label(p)}: cotización recibida`,
    `${who} envió su cotización.`,
  );
}

export function buildRequisicionWinnerSelectedPayload(p) {
  const who = p.proveedorNombre ? ` a ${String(p.proveedorNombre).slice(0, 120)}` : ' un proveedor';
  return build(
    { ...p, link: p.link || `/requisiciones/${p.requisicionId}?tab=licitacion` },
    `${label(p)}: proveedor seleccionado`,
    `${actor(p)} adjudicó la requisición${who}.`,
  );
}

// --- E4: purchase order and deliverables ----------------------------------------------------------------------

const ocLink = (p, tab = 'orden-compra') => p.link || `/requisiciones/${p.requisicionId}?tab=${tab}`;
const ocLabel = (p) => (p.ocNumero ? ` ${String(p.ocNumero).slice(0, 40)}` : '');

export function buildRequisicionPoIssuedPayload(p) {
  return build({ ...p, link: ocLink(p) }, `${label(p)}: orden de compra emitida`, `${actor(p)} emitió la orden de compra${ocLabel(p)}.`);
}

export function buildRequisicionPoApprovalRequestedPayload(p) {
  return build({ ...p, link: ocLink(p) }, `${label(p)}: orden de compra por aprobar`, `${actor(p)} emitió la orden de compra${ocLabel(p)}; está pendiente de tu aprobación.`);
}

export function buildRequisicionPoApprovedPayload(p) {
  return build({ ...p, link: ocLink(p) }, `${label(p)}: orden de compra aprobada`, `${actor(p)} aprobó la orden de compra${ocLabel(p)}.`);
}

export function buildRequisicionPoRejectedPayload(p) {
  return build({ ...p, link: ocLink(p) }, `${label(p)}: orden de compra rechazada`, withReason(`${actor(p)} rechazó la orden de compra${ocLabel(p)}.`, p));
}

export function buildRequisicionPoSentPayload(p) {
  return build({ ...p, link: ocLink(p) }, `${label(p)}: orden de compra enviada`, `${actor(p)} envió la orden de compra${ocLabel(p)} al proveedor.`);
}

export function buildRequisicionDeliverablesReceivedPayload(p) {
  const who = p.proveedorNombre ? String(p.proveedorNombre).slice(0, 120) : 'El proveedor';
  return build({ ...p, link: ocLink(p, 'entregables') }, `${label(p)}: entregables recibidos`, `${who} adjuntó los soportes de entrega; pendientes de revisión.`);
}

export function buildRequisicionDeliverablesReturnedPayload(p) {
  return build({ ...p, link: ocLink(p, 'entregables') }, `${label(p)}: entregables devueltos`, withReason(`${actor(p)} devolvió los entregables al proveedor.`, p));
}

export function buildRequisicionDeliverablesAcceptedPayload(p) {
  return build({ ...p, link: ocLink(p, 'entregables') }, `${label(p)}: entregables aceptados`, `${actor(p)} aceptó los entregables del proveedor.`);
}

export function buildRequisicionReminderDeliverablesPayload(p) {
  return build({ ...p, link: ocLink(p, 'entregables') }, `${label(p)}: entregables devueltos sin re-entrega`, withReason('El proveedor aún no ha vuelto a entregar los soportes devueltos.', p));
}

export function buildRequisicionReminderConfirmationPayload(p) {
  return build(p, `${label(p)}: confirma la entrega`, `Hay una entrega recibida${item(p)} pendiente de tu confirmación.`);
}

/** event name -> builder, for generic callers. */
export const REQUISICION_PAYLOAD_BUILDERS = {
  'requisicion.submitted': buildRequisicionSubmittedPayload,
  'requisicion.approval.requested': buildRequisicionApprovalRequestedPayload,
  'requisicion.level.approved': buildRequisicionLevelApprovedPayload,
  'requisicion.approved': buildRequisicionApprovedPayload,
  'requisicion.rejected': buildRequisicionRejectedPayload,
  'requisicion.withdrawn': buildRequisicionWithdrawnPayload,
  'requisicion.cancelled': buildRequisicionCancelledPayload,
  'requisicion.delivery.registered': buildRequisicionDeliveryRegisteredPayload,
  'requisicion.delivery.confirmed': buildRequisicionDeliveryConfirmedPayload,
  'requisicion.delivery.disputed': buildRequisicionDeliveryDisputedPayload,
  'requisicion.line.closed': buildRequisicionLineClosedPayload,
  'requisicion.closed': buildRequisicionClosedPayload,
  'requisicion.rfq.sent': buildRequisicionRfqSentPayload,
  'requisicion.quote.received': buildRequisicionQuoteReceivedPayload,
  'requisicion.winner.selected': buildRequisicionWinnerSelectedPayload,
  'requisicion.po.issued': buildRequisicionPoIssuedPayload,
  'requisicion.po.approval.requested': buildRequisicionPoApprovalRequestedPayload,
  'requisicion.po.approved': buildRequisicionPoApprovedPayload,
  'requisicion.po.rejected': buildRequisicionPoRejectedPayload,
  'requisicion.po.sent': buildRequisicionPoSentPayload,
  'requisicion.deliverables.received': buildRequisicionDeliverablesReceivedPayload,
  'requisicion.deliverables.returned': buildRequisicionDeliverablesReturnedPayload,
  'requisicion.deliverables.accepted': buildRequisicionDeliverablesAcceptedPayload,
  'requisicion.reminder.deliverables': buildRequisicionReminderDeliverablesPayload,
  'requisicion.reminder.confirmation': buildRequisicionReminderConfirmationPayload,
};
