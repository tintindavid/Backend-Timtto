'use strict';

/**
 * Report states that count as "resolved" when computing OT progress.
 * A cancelled report is resolved (nothing left to do) but is NOT a completed
 * one, so it must keep its own estado instead of being rewritten to 'Cerrado'.
 */
export const REPORT_RESOLVED_STATES = ['Cerrado', 'Cancelado'];

/**
 * Aggregation-pipeline expression: close a report unless it was cancelled.
 * Use inside `$set` of a pipeline update so a Cancelado report linked to a
 * worksheet stays Cancelado.
 */
export const CLOSE_UNLESS_CANCELLED_EXPR = {
  $cond: [{ $eq: ['$estado', 'Cancelado'] }, 'Cancelado', 'Cerrado'],
};
