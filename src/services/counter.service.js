'use strict';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import {
  TICKET_CONSECUTIVO_PREFIX,
  TICKET_CONSECUTIVO_PAD,
  TICKET_COUNTER_KEY,
} from '../constants/ticket.constants.js';
import { requireTenant } from '../utils/tenant.util.js';

/**
 * Counter helpers built on the existing Counter collection (counter.model.js).
 *
 * The counter document is keyed by (tenantId, key) — see counter.model.js
 * — so composite keys like `tickets:{YYYY}` are already supported. This module
 * centralizes the formatting for ticket consecutivos (TKT-{YYYY}-{NNNN}).
 *
 * Per design D16 the consecutivo resets each year (the key embeds the YYYY),
 * is unique per (tenant, year) by atomic $inc, and produces no gaps under
 * concurrent creation (findOneAndUpdate is atomic at the document level).
 */

/**
 * Allocate and format the next ticket consecutivo for the given tenant + year.
 *
 * @param {string} tenantId
 * @param {number} year     four-digit year (defaults to current year)
 * @returns {Promise<{ consecutivo: string, year: number, seq: number }>}
 */
export async function getNextTicketConsecutivo(tenantId, year = new Date().getFullYear()) {
  requireTenant(tenantId);
  const y = Number(year) || new Date().getFullYear();
  const key = TICKET_COUNTER_KEY(y);
  const seq = await getNextSequence(tenantId, key);
  const consecutivo = `${TICKET_CONSECUTIVO_PREFIX}-${y}-${String(seq).padStart(TICKET_CONSECUTIVO_PAD, '0')}`;
  return { consecutivo, year: y, seq };
}

/**
 * Allocate N consecutive ticket consecutivos atomically (per-call), used by
 * batch creation. Each call to $inc is atomic; calling N times in series
 * guarantees uniqueness without collisions across concurrent batches.
 *
 * @param {string} tenantId
 * @param {number} count
 * @param {number} [year]
 * @returns {Promise<Array<{ consecutivo: string, year: number, seq: number }>>}
 */
export async function getNextTicketConsecutivos(tenantId, count, year) {
  requireTenant(tenantId);
  const n = Math.max(0, Number(count) || 0);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(await getNextTicketConsecutivo(tenantId, year));
  }
  return out;
}

// Re-exported for convenience (other modules can keep importing from here).
export { getNextSequence, formatConsecutivo };
