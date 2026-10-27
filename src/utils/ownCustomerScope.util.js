import { ApiError } from './apiError.util.js';
import { logger } from '../config/logger.config.js';
import { getEnforcementMode, normalizeCapabilities } from '../config/tenantCapabilities.config.js';

/**
 * "Mantenimiento propio" scope (change: requisiciones-e1-base-aprobacion, capability managesCustomers).
 *
 * A tenant that executes services but does NOT manage customers works only on its own equipment, so every
 * work order, report and worksheet belongs to the tenant's organization customer.
 *
 * `tenantCtx` is `req.tenant` ({ capabilities, organizationCustomerId }). Without it (internal callers, tests)
 * nothing is enforced. Superadmin and the platform sentinel carry every capability on, so they are not scoped.
 *
 * @param {object|undefined} tenantCtx
 * @returns {{ organizationCustomerId: string }|null} null when the tenant is not scoped
 */
export function getOwnCustomerScope(tenantCtx, { ignoreMode = false } = {}) {
  if (!tenantCtx || !tenantCtx.capabilities) return null;
  const caps = normalizeCapabilities(tenantCtx.capabilities);
  if (caps.managesCustomers || !caps.executesServices) return null;
  if (!ignoreMode && getEnforcementMode() !== 'on') return null;
  const organizationCustomerId = tenantCtx.organizationCustomerId ? String(tenantCtx.organizationCustomerId) : null;
  if (!organizationCustomerId) {
    if (getEnforcementMode() !== 'on') return null;
    throw new ApiError(
      409,
      'Tu organización no tiene configurado su cliente propio. Contacta a TIMTTO para completar la configuración.',
      'ORGANIZATION_CUSTOMER_MISSING',
    );
  }
  return { organizationCustomerId };
}

const NOT_ALLOWED_MESSAGE =
  'Tu organización solo trabaja con su propio cliente: no puedes asignar otro cliente a este registro.';

/**
 * Create path: fills `data[field]` with the organization customer when absent and rejects any other value
 * with 403 CLIENTE_NO_PERMITIDO. No-op for tenants that manage customers.
 */
export function applyOwnCustomerOnCreate(tenantCtx, data, field = 'ClienteId') {
  // Filling a missing value is ALWAYS active (also with ENFORCE_TENANT_CAPABILITIES warn/off): the UI of a
  // scoped tenant omits the client. Only the foreign-client rejection depends on the enforcement mode.
  const scope = getOwnCustomerScope(tenantCtx, { ignoreMode: true });
  if (!scope) return data;
  const given = data[field];
  if (given === undefined || given === null || given === '') {
    data[field] = scope.organizationCustomerId;
  } else if (getEnforcementMode() !== 'on') {
    return data;
  } else if (String(given) !== scope.organizationCustomerId) {
    logger.warn('ownCustomerScope: foreign customer rejected on create', { field });
    throw new ApiError(403, NOT_ALLOWED_MESSAGE, 'CLIENTE_NO_PERMITIDO', { field });
  }
  return data;
}

/**
 * Update path: a value equal to the stored one (a form that re-sends the unchanged client, even a legacy
 * one) or to the organization customer is accepted; anything else is 403 CLIENTE_NO_PERMITIDO.
 * Never fills a missing value.
 */
export function assertOwnCustomerOnUpdate(tenantCtx, givenId, currentId, field = 'ClienteId') {
  if (givenId === undefined || givenId === null || givenId === '') return;
  const scope = getOwnCustomerScope(tenantCtx);
  if (!scope) return;
  const given = String(givenId);
  if (given === scope.organizationCustomerId) return;
  if (currentId && given === String(currentId)) return;
  logger.warn('ownCustomerScope: foreign customer rejected on update', { field });
  throw new ApiError(403, NOT_ALLOWED_MESSAGE, 'CLIENTE_NO_PERMITIDO', { field });
}
