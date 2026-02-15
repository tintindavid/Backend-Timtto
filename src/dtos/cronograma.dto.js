import Joi from 'joi';

/**
 * DTO para generar PDF de cronograma
 */
export const cronogramaPDFDto = Joi.object({
  cliente: Joi.object({
    // Campos requeridos
    tenantId: Joi.string().required(),
    
    // Campos opcionales del negocio
    Razonsocial: Joi.string().optional(),
    Nit: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
    Direccion: Joi.string().optional(),
    Ciudad: Joi.string().optional(),
    Departamento: Joi.string().optional(),
    Email: Joi.string().email().optional(),
    TelContacto: Joi.string().optional(),
    UserContacto: Joi.string().optional(),
    Logo: Joi.string().uri().optional(),
    
    // Campos de MongoDB (permitidos pero ignorados)
    _id: Joi.string().optional(),
    isDeleted: Joi.boolean().optional(),
    deletedAt: Joi.date().allow(null).optional(),
    createdAt: Joi.date().optional(),
    updatedAt: Joi.date().optional(),
    __v: Joi.number().optional(),
  })
    .required()
    .unknown(true), // Permitir campos adicionales no especificados

  grupos: Joi.array()
    .items(
      Joi.object({
        servicio: Joi.string().required(),
        sede: Joi.string().required(),
        equipos: Joi.array()
          .items(
            Joi.object({
              // Campos principales
              _id: Joi.string().optional(),
              Inventario: Joi.string().optional(),
              ItemId: Joi.object({
                _id: Joi.string().optional(),
                Nombre: Joi.string().required(),
              }).optional(),
              Marca: Joi.string().optional(),
              Modelo: Joi.string().optional(),
              Serie: Joi.string().optional(),
              Ubicacion: Joi.string().optional(),
              Estado: Joi.string().optional(),
              mesesMtto: Joi.array()
                .items(
                  Joi.string().valid(
                    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
                    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
                  )
                )
                .optional(),
            }).unknown(true) // Permitir campos adicionales de MongoDB
          )
          .min(0)
          .required(),
      }).unknown(true) // Permitir campos adicionales en grupos
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'Debe incluir al menos un grupo',
    }),

  filtros: Joi.object({
    servicioIds: Joi.array().items(Joi.string()).optional(),
    meses: Joi.array()
      .items(
        Joi.string().valid(
          'ene', 'feb', 'mar', 'abr', 'may', 'jun',
          'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
        )
      )
      .optional(),
    ubicaciones: Joi.array().items(Joi.string()).optional(),
  })
    .optional()
    .unknown(true), // Permitir campos adicionales en filtros
}).messages({
  'any.required': 'El campo {#label} es requerido',
  'object.base': 'El campo {#label} debe ser un objeto válido',
  'array.base': 'El campo {#label} debe ser un array',
});
