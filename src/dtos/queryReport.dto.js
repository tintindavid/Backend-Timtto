import Joi from 'joi';

export const queryReportDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(100),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().optional(),
  // Filtros adicionales
  estado: Joi.string().valid('Pendiente','Abierto', 'En Progreso', 'Cerrado', 'Cancelado','Procesado').optional(),
  estadoOperativo: Joi.string().valid('Operativo', 'Fuera de Servicio', 'En Mantenimiento', 'Espera de Repuestos', 'En Reparacion').optional(),
  tipoMtto: Joi.string().valid('Preventivo', 'Correctivo', 'Predictivo').optional(),
  equipoId: Joi.string().optional(),
  clienteId: Joi.string().optional(),
  otId: Joi.string().optional(),
});
