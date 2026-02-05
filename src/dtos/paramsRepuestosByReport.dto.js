import Joi from 'joi';

export const paramsRepuestosByReportDto = Joi.object({
  reportId: Joi.string().hex().length(24).required().label('reportId'),
});
