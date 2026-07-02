import Joi from 'joi';

/**
 * DTO for PATCH /api/v1/platform/tenants/:id/suspend
 */
export const suspendTenantSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(500).required(),
}).unknown(false);
