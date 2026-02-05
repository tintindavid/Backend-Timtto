import Joi from 'joi';

// DTO permisivo para el endpoint de procesar reportes
// Acepta el objeto completo del reporte y campos adicionales enviados por el frontend
export const processReportDto = Joi.object().unknown(true);
