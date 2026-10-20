import Joi from 'joi';
import { TENANT_TYPES, resolveCapabilitiesInput } from '../config/tenantCapabilities.config.js';

// Tenant data needed to build the organization client of a tenant that does not execute services
// (tenant-capabilities-hybrid-mode, design D7). Checked here so the creation cannot fail halfway.
const ORGANIZATION_REQUIRED_FIELDS = ['nit', 'ciudad', 'departamento', 'email', 'telefono'];

const typeSchema = Joi.string().valid(...TENANT_TYPES);
const capabilitiesSchema = Joi.object({
  executesServices: Joi.boolean(),
  registersExternal: Joi.boolean(),
})
  .unknown(false)
  .min(1);

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
    // Accepted inside `tenant` too (multipart clients send only `tenant` and `admin` as JSON).
    type: typeSchema.optional(),
    capabilities: capabilitiesSchema.optional(),
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

  // Tenant kind: a preset (`type`) or explicit flags (`capabilities`); never both. Default: provider.
  type: typeSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
})
  .unknown(false)
  .custom((value, helpers) => {
    const sources = [value.type, value.capabilities, value.tenant?.type, value.tenant?.capabilities]
      .filter((v) => v !== undefined);
    if (sources.length > 1) return helpers.error('capabilities.ambiguous');

    let caps;
    try {
      caps = resolveCapabilitiesInput({
        type: value.type ?? value.tenant?.type,
        capabilities: value.capabilities ?? value.tenant?.capabilities,
      });
    } catch (err) {
      return helpers.error('capabilities.noneEnabled');
    }

    if (!caps.executesServices) {
      const missing = ORGANIZATION_REQUIRED_FIELDS.filter((f) => {
        const v = value.tenant?.[f];
        return v === undefined || v === null || String(v).trim() === '';
      });
      if (missing.length) return helpers.error('capabilities.missingTenantData', { fields: missing.join(', ') });
    }
    return value;
  })
  .messages({
    'capabilities.ambiguous': 'Envía solo uno entre type y capabilities',
    'capabilities.noneEnabled': 'Al menos una capacidad debe estar habilitada',
    'capabilities.missingTenantData':
      'Una organización que no ejecuta servicios requiere los datos del tenant: {{#fields}}',
  });
