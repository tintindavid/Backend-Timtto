import Joi from 'joi';
import { TENANT_TYPES } from '../config/tenantCapabilities.config.js';

/**
 * DTO for PATCH /api/v1/platform/tenants/:id/capabilities (SuperAdmin only).
 *
 * Either a preset (`type`) or loose flags (`executesServices`, `registersExternal`, merged over the
 * stored values), never both. `usesQrs` (premium module "QRs y tickets") is independent and may go with either. `organizationCustomerId` names the organization client when the tenant
 * has several clients and is switched to one that does not execute services.
 * The resulting flags are validated again by the service (at least one must be true).
 */
export const updateTenantCapabilitiesSchema = Joi.object({
  type: Joi.string().valid(...TENANT_TYPES),
  executesServices: Joi.boolean(),
  registersExternal: Joi.boolean(),
  usesQrs: Joi.boolean(),
  scheduleQuickLoad: Joi.boolean(),
  usesInventoryBasic: Joi.boolean(),
  usesInventoryAdvanced: Joi.boolean(),
  usesRequisiciones: Joi.boolean(),
  managesCustomers: Joi.boolean(),
  organizationCustomerId: Joi.string().hex().length(24),
})
  .oxor('type', 'executesServices')
  .oxor('type', 'registersExternal')
  .unknown(false)
  .min(1);
