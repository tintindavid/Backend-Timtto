import Joi from 'joi';

export const updateTenantSchema = Joi.object({
  name: Joi.string().trim().optional(),
  direccion: Joi.string().trim().optional().allow(null, ''),
  email: Joi.string().email().trim().optional().allow(null, ''),
  ciudad: Joi.string().trim().optional().allow(null, ''),
  telefono: Joi.string().trim().optional().allow(null, ''),
  departamento: Joi.string().trim().optional().allow(null, ''),
  pais: Joi.string().trim().optional().allow(null, ''),
  nit: Joi.string().trim().optional().allow(null, ''),
  website: Joi.string().uri().trim().optional().allow(null, ''),
  logoUrl: Joi.string().uri().trim().optional().allow(null, ''),
  status: Joi.string().valid('active', 'suspended', 'closed').optional(),
  plan: Joi.string().trim().optional(),
  ownerId: Joi.string().trim().optional().allow(null, ''),
  settings: Joi.object().optional(),
  // Permitir campos adicionales del frontend
  contactEmail: Joi.string().email().optional().allow(null, ''),
  phone: Joi.string().trim().optional().allow(null, ''),
  slug: Joi.string().trim().optional().allow(null, ''),
}).options({ stripUnknown: true }); // Ignorar campos desconocidos en lugar de fallar
