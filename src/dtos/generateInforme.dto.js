'use strict';
import Joi from 'joi';
import { MONTHS } from '../utils/monthRange.util.js';

export const generateInformeDto = Joi.object({
  clienteId: Joi.string().hex().length(24).required().messages({
    'string.hex': 'clienteId must be a valid MongoDB ObjectId',
    'string.length': 'clienteId must be a valid MongoDB ObjectId',
    'any.required': 'clienteId is required',
  }),
  mesDesde: Joi.string().valid(...MONTHS).required().messages({
    'any.only': `mesDesde must be one of: ${MONTHS.join(', ')}`,
    'any.required': 'mesDesde is required',
  }),
  mesHasta: Joi.string().valid(...MONTHS).required().messages({
    'any.only': `mesHasta must be one of: ${MONTHS.join(', ')}`,
    'any.required': 'mesHasta is required',
  }),
  observacionGeneral: Joi.string().allow('').max(2000).optional(),
}).custom((val, helpers) => {
  const fromIdx = MONTHS.indexOf(val.mesDesde);
  const toIdx   = MONTHS.indexOf(val.mesHasta);
  if (fromIdx > toIdx) {
    return helpers.error('any.invalid', {
      message: `mesHasta (${val.mesHasta}) must be equal to or after mesDesde (${val.mesDesde})`,
    });
  }
  return val;
}).messages({
  'any.invalid': 'mesHasta must be equal to or after mesDesde',
});
