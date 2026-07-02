import Joi from 'joi';

// Values that cannot be used as tenantId
const RESERVED_TENANT_IDS = ['__platform__'];

/**
 * DTO for POST /api/v1/platform/tenants
 * Creates a tenant together with its first admin user.
 *
 * Protected/auto-assigned fields NOT accepted here:
 *   status (always 'active'), ownerId (set after user creation), isDeleted.
 * tenantId is NEVER accepted from req.body (comes from this object's tenant.tenantId).
 */
export const createTenantWithAdminSchema = Joi.object({
  tenant: Joi.object({
    tenantId: Joi.string()
      .trim()
      .lowercase()
      .min(3)
      .max(50)
      // Only lowercase alphanumeric, hyphen, underscore; must start with alphanum
      .pattern(/^[a-z0-9][a-z0-9-_]*$/)
      .invalid(...RESERVED_TENANT_IDS)
      .required()
      .messages({
        'string.pattern.base':
          'tenantId solo puede contener letras minúsculas, números, guiones y guiones bajos, y debe empezar con letra o número',
        'any.invalid': `tenantId '${RESERVED_TENANT_IDS.join(', ')}' está reservado`,
      }),
    name: Joi.string().trim().min(1).max(200).required(),
    slogan: Joi.string().trim().max(300).allow(null, '').optional(),
    direccion: Joi.string().trim().max(300).allow(null, '').optional(),
    email: Joi.string().email().lowercase().trim().allow(null, '').optional(),
    ciudad: Joi.string().trim().max(100).allow(null, '').optional(),
    telefono: Joi.string().trim().max(50).allow(null, '').optional(),
    departamento: Joi.string().trim().max(100).allow(null, '').optional(),
    pais: Joi.string().trim().max(100).allow(null, '').optional(),
    nit: Joi.string().trim().max(50).allow(null, '').optional(),
    website: Joi.string().uri().allow(null, '').optional(),
    plan: Joi.string().trim().max(50).optional(),
  })
    .unknown(false)
    .required(),

  admin: Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    firstName: Joi.string().trim().min(1).max(100).required(),
    lastName: Joi.string().trim().min(1).max(100).required(),
    phone: Joi.string().trim().max(50).allow(null, '').optional(),
  })
    .unknown(false)
    .required(),
}).unknown(false);
