import Joi from 'joi';

export const queryOTDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().allow('').optional(),
  Cliente: Joi.string().hex().length(24).optional(),
  ClienteId: Joi.string().hex().length(24).optional(),
  // Filters added 2026-08-02 for the /ots list search UI. `Consecutivo` is
  // a partial-match on the OT number; `EstadoOt` is exact. `clienteName`
  // is a partial-match on the populated Customer.Razonsocial handled by
  // the service via a two-step lookup (Customer.find → OT.find $in).
  Consecutivo: Joi.string().max(100).allow('').optional(),
  EstadoOt: Joi.string().max(80).allow('').optional(),
  clienteName: Joi.string().max(200).allow('').optional(),
});
