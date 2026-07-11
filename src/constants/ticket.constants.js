'use strict';

/**
 * Ticket lifecycle and policy constants.
 *
 * Single source of truth for status, urgency, source, closingReason
 * enumerations referenced by the schema, services, controllers and DTOs.
 *
 * Keep values in sync with openspec/changes/add-ticket-area-module/specs/tickets/spec.md
 * and design.md (decisions D4, D13, D17, D18).
 */

export const TICKET_STATUS = Object.freeze({
  PENDIENTE: 'pendiente',
  EN_PROCESO: 'en_proceso',
  CERRADO: 'cerrado',
  CANCELADO: 'cancelado',
});
export const TICKET_STATUS_VALUES = Object.freeze(Object.values(TICKET_STATUS));

export const TICKET_URGENCY = Object.freeze({
  NORMAL: 'normal',
  URGENTE: 'urgente',
  CRITICO: 'critico',
});
export const TICKET_URGENCY_VALUES = Object.freeze(Object.values(TICKET_URGENCY));

export const TICKET_SOURCE = Object.freeze({
  QR: 'qr',
  ADMIN: 'admin',
});
export const TICKET_SOURCE_VALUES = Object.freeze(Object.values(TICKET_SOURCE));

export const TICKET_CLOSING_REASON = Object.freeze({
  OT_CLOSED: 'ot_closed',
  REPORT_CANCELLED: 'report_cancelled',
  EQUIPMENT_DELETED: 'equipment_deleted',
  MANUAL: 'manual',
});
export const TICKET_CLOSING_REASON_VALUES = Object.freeze(Object.values(TICKET_CLOSING_REASON));

/**
 * Maps ticket urgency -> OT priority enum value (matches ot.model.js OtPrioridad).
 * Per design D18: when OT groups N tickets, OT.OtPrioridad = max mapped urgency.
 */
export const URGENCY_TO_OT_PRIORITY = Object.freeze({
  [TICKET_URGENCY.NORMAL]: 'Media',
  [TICKET_URGENCY.URGENTE]: 'Alta',
  [TICKET_URGENCY.CRITICO]: 'Urgente',
});

/**
 * Ordering used to compute the MAX OT priority across tickets in a batch.
 * Higher number = higher priority.
 */
export const OT_PRIORITY_RANK = Object.freeze({
  Baja: 1,
  Media: 2,
  Alta: 3,
  Urgente: 4,
});

/**
 * Format: TKT-{YYYY}-{NNNN}
 * Counter key: tickets:{tenantId}:{YYYY}
 */
export const TICKET_CONSECUTIVO_PREFIX = 'TKT';
export const TICKET_CONSECUTIVO_PAD = 4;
export const TICKET_COUNTER_KEY = (year) => `tickets:${year}`;

/**
 * Time-window for public listing per design (the requirement spec says 30 days).
 */
export const TICKET_PUBLIC_LIST_WINDOW_DAYS = 30;

/**
 * Public requestedBy validation policy.
 */
export const REQUESTED_BY_NAME_REGEX = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{3,80}$/;
export const REQUESTED_BY_POSITION_MIN = 2;
export const REQUESTED_BY_POSITION_MAX = 60;

/**
 * Max equipments allowed in one batch submission (sanity cap, not security).
 */
export const TICKET_BATCH_MAX_EQUIPMENTS = 50;

/**
 * Default observations text length cap to prevent abuse.
 */
export const TICKET_OBSERVATION_MAX_LENGTH = 2000;
