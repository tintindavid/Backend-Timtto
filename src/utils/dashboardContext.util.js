'use strict';

import { ApiError } from './apiError.util.js';
import { getOwnCustomerScope } from './ownCustomerScope.util.js';
import { normalizeCapabilities } from '../config/tenantCapabilities.config.js';
import { resolvePeriod } from './dashboardPeriod.util.js';

const PLATFORM_TENANT = '__platform__';

/**
 * Common context of every dashboard endpoint (change: dashboard-por-tenant-indicadores, design D2/D3/D12).
 *
 *  - The tenant is ONLY `req.tenantId` (a `tenantId` in the query/body is ignored). No tenant, or the platform
 *    sentinel of a superadmin that is not in "view as", is 400 TENANT_REQUIRED: there are no global totals.
 *  - A tenant that works only with its own customer gets `clienteId` forced to the organization customer.
 *  - Capabilities come from `req.tenant.capabilities` (normalized); permissions from `req.user.permissions`.
 *
 * @param {import('express').Request} req
 * @param {Date} [now]
 */
export function buildDashboardContext(req, now = new Date()) {
  const tenantId = req.tenantId;
  if (!tenantId || tenantId === PLATFORM_TENANT) {
    throw new ApiError(400, 'Selecciona un tenant para ver el dashboard', 'TENANT_REQUIRED');
  }

  const q = req.query || {};
  const period = resolvePeriod({ periodo: q.periodo, desde: q.desde, hasta: q.hasta, anio: q.anio }, now);

  const scope = getOwnCustomerScope(req.tenant);
  const capabilities = normalizeCapabilities(req.tenant?.capabilities);
  const user = req.user || {};

  return {
    tenantId: String(tenantId),
    userId: user.userId ? String(user.userId) : null,
    isSuperadmin: user.role === 'superadmin',
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    capabilities,
    period,
    now,
    filters: {
      clienteId: scope ? scope.organizationCustomerId : (q.clienteId || null),
      sedeId: q.sedeId || null,
      servicioId: q.servicioId || null,
      tipoMtto: q.tipoMtto || null,
      tecnicoId: q.tecnicoId || null,
    },
    ownCustomerScoped: Boolean(scope),
    // filters sent that an endpoint could not apply at runtime (see dashboard.common notApplied)
    ignoredFilters: new Set(),
  };
}

/** Same rule as the `authorize` middleware: superadmin bypasses, anyone else needs the permission. */
export function ctxHasPermission(ctx, permission) {
  return ctx.isSuperadmin || ctx.permissions.includes(permission);
}
