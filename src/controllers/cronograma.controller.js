import cronogramaPDFService from '../services/cronogramaPDF.service.js';
import { Tenant } from '../models/tenant.model.js';
import { Customer } from '../models/customer.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { User } from '../models/user.model.js';
import { logger } from '../config/logger.config.js';
import { ApiError } from '../utils/apiError.util.js';

/**
 * Descarga el PDF del cronograma de mantenimiento
 * @route POST /api/v1/cronogramas/pdf
 */
export const downloadCronogramaPDF = async (req, res, next) => {
  try {
    const { clienteId, filtros = {} } = req.body;
    const userId = req.userId;
    const tenantId = req.headers['x-tenant-id'];

    if (!tenantId) {
      throw new ApiError(400, 'Falta el header x-tenant-id', 'MISSING_TENANT_HEADER');
    }

    // Obtener cliente de la DB
    const cliente = await Customer.findOne({ _id: clienteId, tenantId }).lean();
    if (!cliente) {
      throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND');
    }

    // Obtener información completa del tenant
    const tenantData = await Tenant.findOne({ tenantId, isDeleted: false }).lean();
    if (!tenantData) {
      throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    }

    // Obtener información del usuario
    const userData = await User.findById(userId).lean();

    // Construir query de EquipoItem con los filtros recibidos
    const { sedeIds, servicioIds, meses, ubicaciones, estado } = filtros;
    const equipoQuery = {
      ClienteId: clienteId,
      tenantId,
      ...(sedeIds?.length && { SedeId: { $in: sedeIds } }),
      ...(servicioIds?.length && { Servicio: { $in: servicioIds } }),
      ...(meses?.length && { mesesMtto: { $in: meses } }),
      ...(ubicaciones?.length && { Ubicacion: { $in: ubicaciones } }),
      ...(estado && { Estado: estado }),
    };

    const equipos = await EquipoItem.find(equipoQuery)
      .populate('ItemId', 'Nombre')
      .populate('SedeId', 'nombreSede')
      .populate('Servicio', 'nombre')
      .lean();

    if (!equipos.length) {
      throw new ApiError(404, 'No se encontraron equipos con los filtros especificados', 'NO_EQUIPOS');
    }

    // Agrupar equipos por servicio/sede
    const gruposMap = {};
    for (const equipo of equipos) {
      const servicioNombre = equipo.Servicio?.nombre || 'Sin Servicio';
      const sedeNombre = equipo.SedeId?.nombreSede || 'Sin Sede';
      const key = `${servicioNombre}|${sedeNombre}`;
      if (!gruposMap[key]) {
        gruposMap[key] = { servicio: servicioNombre, sede: sedeNombre, equipos: [] };
      }
      gruposMap[key].equipos.push(equipo);
    }
    const grupos = Object.values(gruposMap);

    logger.info('Generando PDF de Cronograma', {
      tenantId,
      clienteId,
      cantidadEquipos: equipos.length,
      cantidadGrupos: grupos.length,
      userId,
    });

    // Generar PDF
    const pdfBuffer = await cronogramaPDFService.generatePDF(
      { cliente, grupos, filtros },
      tenantData,
      userData
    );

    const filename = `Cronograma_${cliente.Razonsocial?.replace(/\s+/g, '_')}_${Date.now()}.pdf`;

    logger.info('PDF de Cronograma generado exitosamente', {
      tenantId,
      filename,
      size: pdfBuffer.length,
      userId,
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
      tenantId: req.headers['x-tenant-id'],
      requestBody: {
        hasClienteId: !!req.body?.clienteId,
        hasFiltros: !!req.body?.filtros,
        filtrosKeys: Object.keys(req.body?.filtros || {}),
      },
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
