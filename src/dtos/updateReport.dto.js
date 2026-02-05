import Joi from 'joi';

export const updateReportDto = Joi.object({
  procesado: Joi.boolean().optional().label('procesado'),
  fechaProcesado: Joi.date().optional().label('fechaProcesado'),
  // Allow commonly updated fields
  estado: Joi.string().optional().label('estado'),
  MotivoFueraDeServicio: Joi.string().allow('').optional().label('MotivoFueraDeServicio'),
  fechaFinalizdo: Joi.date().optional().label('fechaFinalizdo'),
  hojaDeTrabajo: Joi.string().hex().length(24).optional().label('hojaDeTrabajo'),
  estadoOperativo: Joi.string().valid('Operativo', 'Fuera de Servicio', 'En Mantenimiento', 'Espera de Repuestos', 'En Reparacion', 'Dado de Baja').optional().label('estadoOperativo'),
  Observacion: Joi.string().allow('').optional().label('Observacion'),
  CausaEncontrada: Joi.string().allow('').optional().label('CausaEncontrada'),
  fechaCancelacion: Joi.date().optional().label('fechaCancelacion'),
  motivoCancelacion: Joi.string().allow('').optional().label('motivoCancelacion'),
  ResponsableMtto: Joi.object({
    _id: Joi.string().allow('').optional(),
    firstName: Joi.string().optional(),
    lastName: Joi.string().optional(),
  }).optional().label('ResponsableMtto'),
}).unknown(true); // Permitir campos adicionales sin validarlos