'use strict';

import { Tenant } from '../models/tenant.model.js';
import { DEFAULT_CURRENCY } from '../constants/requisicion.constants.js';

/** Base currency of a tenant: `tenant.settings.currency` (ISO 4217, 3 letters) or COP. */
export async function getTenantCurrency(tenantId) {
  const tenant = await Tenant.findOne({ tenantId }, { settings: 1 }).lean();
  const raw = tenant?.settings?.currency;
  return typeof raw === 'string' && /^[A-Za-z]{3}$/.test(raw.trim()) ? raw.trim().toUpperCase() : DEFAULT_CURRENCY;
}
