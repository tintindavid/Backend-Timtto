import Joi from 'joi';

export const createTenantSchema = Joi.object({
  tenantId: Joi.string().trim().required(),
  name: Joi.string().trim().required(),
  status: Joi.string().valid('active', 'suspended', 'closed').default('active'),
  plan: Joi.string().trim().default('free'),
  ownerId: Joi.string().trim().optional().allow(null),
  contact: Joi.object({ email: Joi.string().email().optional().allow(null), phone: Joi.string().trim().optional().allow(null) }).optional(),
  settings: Joi.object().optional(),
});
