import Joi from 'joi';

// Reserved tenantId values that must never be used for a real business tenant.
const RESERVED_TENANT_IDS = ['__platform__'];

export const createTenantSchema = Joi.object({
  tenantId: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9-]+$/, 'lowercase alphanumeric with hyphens')
    .invalid(...RESERVED_TENANT_IDS)
    .required()
    .messages({
      'any.invalid': 'tenantId is reserved and cannot be used',
      'string.pattern.name': 'tenantId must contain only lowercase letters, numbers, and hyphens',
    }),
  name: Joi.string().trim().required(),
  status: Joi.string().valid('active', 'suspended', 'closed').default('active'),
  plan: Joi.string().trim().default('free'),
  ownerId: Joi.string().trim().optional().allow(null),
  contact: Joi.object({
    email: Joi.string().email().optional().allow(null),
    phone: Joi.string().trim().optional().allow(null),
  }).optional(),
  settings: Joi.object().optional(),
}).unknown(false);
