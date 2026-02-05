'use strict';

import { logger } from "../config/logger.config.js";

export function requireTenant(tenantId) {
  if (!tenantId) {
    throw new Error('TenantId is required');
  }
  return tenantId;
}

export function applyTenantFilter(query = {}, tenantId) {
  if (!tenantId) return query;
  return { ...query, tenantId };
}
