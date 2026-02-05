import Joi from 'joi';

export const paramsReportByOtDto = Joi.object({
  otId: Joi.string().hex().length(24).required().label('otId'),
});
