import Joi from 'joi';

/**
 * DTO for POST /api/v1/platform/users/:userId/reset-password.
 *
 * The operation is identified entirely by the :userId path param — no body
 * fields are required. This schema enforces that no unexpected body is sent.
 */
export const resetPasswordCrossTenantSchema = Joi.object({}).unknown(false);
