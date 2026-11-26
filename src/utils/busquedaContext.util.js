'use strict';

import { ApiError } from './apiError.util.js';
import { getOwnCustomerScope } from './ownCustomerScope.util.js';
import { normalizeCapabilities } from '../config/tenantCapabilities.config.js';

const PLATFORM_TENANT = '__platform__';

/**
 * Context of the equipment search and summary (change: buscador-equipos). The tenant is ONLY `req.tenantId`; a tenant
 * that works only with its own customer gets `clienteId` set to the organization customer.
 *
 * @param {import('express').Request} req
 */
export function buildBusquedaContext(req) {
  const tenantId = req.tenantId;
  if (!tenantId || tenantId === PLATFORM_TENANT) {
    throw new ApiError(400, 'Selecciona un tenant para buscar equipos', 'TENANT_REQUIRED');
  }
  const scope = getOwnCustomerScope(req.tenant);
  const user = req.user || {};
  return {
    tenantId: String(tenantId),
    isSuperadmin: user.role === 'superadmin',
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    capabilities: normalizeCapabilities(req.tenant?.capabilities),
    clienteId: scope ? scope.organizationCustomerId : null,
  };
}
