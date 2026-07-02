import Joi from 'joi';

/**
 * DTO for:
 *   PUT /api/v1/platform/tenants/:id  (SuperAdmin edits any tenant)
 *   PUT /api/v1/my-tenant             (Admin edits own tenant)
 *
 * Allowed fields: name, slogan, direccion, email, ciudad, telefono,
 *                 departamento, pais, nit, website, logoUrl.
 *
 * Rejected fields (silently stripped by the service as a second layer of defence,
 * but the DTO rejects them here at the boundary):
 *   tenantId, status, plan, ownerId, isDeleted, deletedAt.
 */
export const updateTenantMetadataSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).optional(),
  slogan: Joi.string().trim().max(300).allow(null, '').optional(),
  direccion: Joi.string().trim().max(300).allow(null, '').optional(),
  email: Joi.string().email().lowercase().trim().allow(null, '').optional(),
  ciudad: Joi.string().trim().max(100).allow(null, '').optional(),
  telefono: Joi.string().trim().max(50).allow(null, '').optional(),
  departamento: Joi.string().trim().max(100).allow(null, '').optional(),
  pais: Joi.string().trim().max(100).allow(null, '').optional(),
  nit: Joi.string().trim().max(50).allow(null, '').optional(),
  website: Joi.string().uri().allow(null, '').optional(),
  logoUrl: Joi.string().uri().allow(null, '').optional(),
})
  .unknown(false)
  .min(1); // At least one field must be provided
