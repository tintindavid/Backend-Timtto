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
 */

function base({ requisicionId, consecutivo, nivel }) {
  const id = requisicionId != null ? String(requisicionId) : null;
  return {
    requisicionId: id,
    consecutivo: consecutivo || '',
    ...(nivel != null ? { nivel } : {}),
    link: id ? `/requisiciones/${id}` : '/requisiciones',
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

/** event name -> builder, for generic callers. */
export const REQUISICION_PAYLOAD_BUILDERS = {
  'requisicion.submitted': buildRequisicionSubmittedPayload,
  'requisicion.approval.requested': buildRequisicionApprovalRequestedPayload,
  'requisicion.level.approved': buildRequisicionLevelApprovedPayload,
  'requisicion.approved': buildRequisicionApprovedPayload,
  'requisicion.rejected': buildRequisicionRejectedPayload,
  'requisicion.withdrawn': buildRequisicionWithdrawnPayload,
  'requisicion.cancelled': buildRequisicionCancelledPayload,
};
