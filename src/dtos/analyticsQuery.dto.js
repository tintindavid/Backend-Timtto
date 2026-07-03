import Joi from 'joi';

/**
 * DTO for query params on all platform analytics endpoints.
 *
 * - from / to: ISO date strings. Optional. When both present, to must be >= from.
 * - includeDeleted: boolean flag (tenants breakdown only). Default false.
 *
 * tenantId is NEVER validated here — it comes from req.tenant middleware.
 */
export const analyticsQuerySchema = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  includeDeleted: Joi.boolean().optional().default(false),
})
  .unknown(false)
  .custom((value, helpers) => {
    if (value.from && value.to && value.to < value.from) {
      return helpers.error('any.invalid', {
        message: 'El parámetro to debe ser mayor o igual que from',
      });
    }
    return value;
  })
  .messages({
    'any.invalid': 'El parámetro to debe ser mayor o igual que from',
  });
