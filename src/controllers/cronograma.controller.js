import cronogramaPDFService from '../services/cronogramaPDF.service.js';
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { logger } from '../config/logger.config.js';
import { ApiError } from '../utils/apiError.util.js';

/**
 * Descarga el PDF del cronograma de mantenimiento
 * @route POST /api/v1/cronogramas/pdf
 */
export const downloadCronogramaPDF = async (req, res, next) => {
  try {
    const { cliente, grupos, filtros } = req.body;
    const userId = req.userId;

    logger.info('user de request:',{userId})

    // Validar datos requeridos
    if (!cliente || !grupos) {
      throw new ApiError(400, 'Faltan datos requeridos (cliente, grupos)', 'MISSING_DATA');
    }

    // Obtener información completa del tenant
    const tenantData = await Tenant.findOne({ 
      tenantId: cliente.tenantId, 
      isDeleted: false 
    }).lean();

    // Obtener información del usuario
    const userData = await User.findById(userId).lean();

    if (!tenantData) {
      throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    }

    logger.info('Generando PDF de Cronograma', {
      tenantId: cliente.tenantId,
      cantidadGrupos: grupos.length,
      userId: userId,
    });

    // Generar PDF
    const pdfBuffer = await cronogramaPDFService.generatePDF(
      {
        cliente,
        grupos,
        filtros,
      },
      tenantData, 
      userData
    );

    // Configurar headers para descarga (MOVER ANTES DEL LOG)
    const filename = `Cronograma_${cliente.Razonsocial?.replace(/\s+/g, '_')}_${Date.now()}.pdf`;

    logger.info('PDF de Cronograma generado exitosamente', {
      tenantId: cliente.tenantId,
      filename,
      size: pdfBuffer.length,
      userId: userId,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (error) {
    logger.error('❌ Error en downloadCronogramaPDF controller:', {
      message: error.message,
      statusCode: error.statusCode || 500,
      code: error.code || 'UNKNOWN',
      details: error.details || {},
      stack: error.stack,
      userId: req.userId,
      tenantId: req.tenantId,
      requestBody: {
        hasClienteId: !!req.body?.clienteId,
        hasFiltros: !!req.body?.filtros,
        filtrosKeys: Object.keys(req.body?.filtros || {})
      }
    });
    next(error);
  }
};

/**
 * Vista previa del HTML del cronograma (solo desarrollo)
 * @route POST /api/v1/cronogramas/preview
 */
export const previewCronogramaHTML = async (req, res, next) => {
  try {
    // Solo permitir en desarrollo
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(403, 'Endpoint no disponible en producción', 'FORBIDDEN');
    }

    const { cliente, grupos, filtros } = req.body;

    if (!cliente || !grupos) {
      throw new ApiError(400, 'Faltan datos requeridos (cliente, grupos)', 'MISSING_DATA');
    }

    // Obtener tenant si es necesario
    let clienteCompleto = cliente;
    if (cliente.tenantId && !cliente.Razonsocial) {
      const tenant = await Tenant.findOne({ 
        tenantId: cliente.tenantId,
        isDeleted: false 
      }).lean();

      if (tenant) {
        clienteCompleto = { ...cliente, ...tenant };
      }
    }

    const html = cronogramaPDFService.generateHTML({
      cliente: clienteCompleto,
      grupos,
      filtros,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (error) {
    logger.error('Error en previewCronogramaHTML:', { error: error.message });
    next(error);
  }
};
