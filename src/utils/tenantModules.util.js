import { ApiError } from './apiError.util.js';
import { Tenant } from '../models/tenant.model.js';
import { logger } from '../config/logger.config.js';
import { getEnforcementMode, normalizeCapabilities } from '../config/tenantCapabilities.config.js';

/**
 * Premium modules for requests that have no logged user (public QR pages, public ticket portal).
 * The global guard (enforceTenantCapabilities) only sees authenticated requests, so the public services
 * read the capabilities of the tenant behind the token/QR with these helpers.
 */

/** Normalized capabilities of a tenant (defaults for an absent field; everything off for an unknown tenant). */
export async function getTenantCapabilities(tenantId) {
  if (!tenantId) return normalizeCapabilities(null);
  const tenant = await Tenant.findOne({ tenantId }, { capabilities: 1 }).lean();
  return normalizeCapabilities(tenant?.capabilities);
}

/**
 * Raw state of a capability (NO rollout switch): true only when the tenant really has it. Used where a feature must
 * HIDE or LOCK something depending on the module (e.g. Repuestos with Requisiciones), regardless of the enforcement
 * mode of the route guard. Pass already loaded `capabilities` to avoid a query.
 */
export async function isCapabilityOn(tenantId, capability, capabilities = null) {
  const caps = capabilities ? normalizeCapabilities(capabilities) : await getTenantCapabilities(tenantId);
  return Boolean(caps[capability]);
}

/**
 * True when `capability` is on for the tenant, honouring the rollout switch ENFORCE_TENANT_CAPABILITIES:
 * `off` always allows and `warn` allows after logging the denial.
 *
 * @param {string} tenantId
 * @param {'executesServices'|'registersExternal'|'usesQrs'} capability
 * @param {object} [capabilities] already loaded capabilities (avoids a second query)
 */
export async function isModuleEnabled(tenantId, capability, capabilities = null) {
  const caps = capabilities ? normalizeCapabilities(capabilities) : await getTenantCapabilities(tenantId);
  if (caps[capability]) return true;
  const mode = getEnforcementMode();
  if (mode === 'off') return true;
  if (mode === 'warn') {
    logger.warn('tenantModules: would deny (warn mode, request allowed)', { tenantId, capability });
    return true;
  }
  return false;
}

/**
 * Throws 403 CAPABILITY_DISABLED when the RAW capability is off, whatever ENFORCE_TENANT_CAPABILITIES says (warn/off do
 * NOT relax it). For writes of a premium module that must never run for a tenant without it.
 */
export async function assertCapabilityOn(tenantId, capability, capabilities = null, message = 'Tu organización no tiene habilitada esta función') {
  if (await isCapabilityOn(tenantId, capability, capabilities)) return;
  throw new ApiError(403, message, 'CAPABILITY_DISABLED', { capability });
}
