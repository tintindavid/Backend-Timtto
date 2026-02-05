import Joi from 'joi';

// Accept batch: equipos: [{ equipoId } | { equipo: { ... } }]
export const addEquipoToOtDto = Joi.object({
  equipos: Joi.array().items(
    Joi.alternatives().try(
      Joi.object({ equipoId: Joi.string().hex().length(24).required() }),
      Joi.object({ equipo: Joi.object().required() })
    )
  ).min(1).required(),
  createReport: Joi.boolean().default(true),
  reportPayload: Joi.object().optional(),
}).required();
