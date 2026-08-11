'use strict';
import { Customer } from '../models/customer.model.js';
import { applyTenantFilter } from './tenant.util.js';
import { logger } from '../config/logger.config.js';
import { SHEET_SIGN_CORREOUSADOS_MAX } from '../constants/sheetwork.constants.js';

/**
 * $addToSet-appends `email` (lowercased) into `Customer.correousados` and
 * truncates the oldest entries when the soft cap is exceeded.
 *
 * Two-step because MongoDB $addToSet doesn't expose the resulting length in
 * the same operation; a follow-up $slice on $push trims. Race conditions are
 * acceptable — the cap is a UX ceiling, not a correctness constraint.
 *
 * Errors are logged and swallowed so callers can treat this as best-effort
 * (matches the original sheetWorkService behavior).
 */
export async function pushCorreoUsado(customerId, tenantId, email) {
  if (!customerId || !email) return;
  const normalized = String(email).toLowerCase().trim();
  if (!normalized) return;
  try {
    await Customer.updateOne(
      applyTenantFilter({ _id: customerId }, tenantId),
      { $addToSet: { correousados: normalized } }
    );
    const cust = await Customer.findOne(applyTenantFilter({ _id: customerId }, tenantId))
      .select('correousados')
      .lean();
    const overflow = (cust?.correousados?.length || 0) - SHEET_SIGN_CORREOUSADOS_MAX;
    if (overflow > 0) {
      await Customer.updateOne(
        applyTenantFilter({ _id: customerId }, tenantId),
        { $push: { correousados: { $each: [], $slice: -SHEET_SIGN_CORREOUSADOS_MAX } } }
      );
    }
  } catch (err) {
    logger.warn('pushCorreoUsado: correousados update failed (non-fatal)', {
      customerId: String(customerId),
      err: String(err),
    });
  }
}
