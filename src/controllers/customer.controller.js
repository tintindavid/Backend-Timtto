import { logger } from '../config/logger.config.js';
import { customerService } from '../services/customer.service.js';
import { inventarioExportService } from '../services/inventarioExport.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';

function escapeCSV(value) {
  const str = String(value ?? '');
  const dangerous = ['=', '+', '-', '@'];
  const needsQuote =
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r') ||
    dangerous.some(c => str.startsWith(c));
  if (needsQuote) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function toCSV(customers) {
  const headers = [
    'Razón Social', 'NIT', 'Email', 'Ciudad', 'Departamento',
    'Dirección', 'Teléfono', 'Contacto', 'Fecha Creación',
  ];
  const rows = customers.map(c => [
    c.Razonsocial,
    c.Nit,
    c.Email,
    c.Ciudad,
    c.Departamento,
    c.Direccion,
    c.TelContacto,
    c.UserContacto,
    c.createdAt ? new Date(c.createdAt).toLocaleDateString('es-CO') : '',
  ].map(escapeCSV).join(','));
  return [headers.join(','), ...rows].join('\r\n');
}

export class CustomerController {
  async create(req, res, next) {
    try {
      logger.info('Creando Customer con datos desde controller', {
        tenantId: req.tenantId,
        data: req.body,
        hasFile: !!req.file,
      });
      // req.file contiene el archivo de logo si se proporcionó
      const data = await customerService.create(req.body, req.tenantId, req.file);
      res.status(201).json(successResponse(data, 'Customer creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await customerService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Customers recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await customerService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Customer recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      logger.info('Actualizando Customer', {
        id: req.params.id,
        hasFile: !!req.file,
      });
      logger.debug('Datos de actualización del Customer:', req.body);
      // req.file contiene el nuevo logo si se proporcionó
      const data = await customerService.update(req.params.id, req.body, req.tenantId, req.file);
      res.json(successResponse(data, 'Customer actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await customerService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Customer eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  async downloadInventario(req, res, next) {
    try {
      const { id } = req.params;
      const formato = req.query.formato || 'excel';

      if (!['excel', 'pdf'].includes(formato)) {
        return next(new ApiError(400, "El parámetro 'formato' debe ser 'excel' o 'pdf'", 'INVALID_FORMAT'));
      }

      if (!['admin', 'technician'].includes(req.user?.role)) {
        return next(new ApiError(403, 'No tienes permiso para descargar inventarios', 'FORBIDDEN'));
      }

      if (formato === 'excel') {
        const buffer = await inventarioExportService.generateExcel(id, req.tenantId);
        const filename = `inventario_${id}_${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(Buffer.from(buffer));
      }

      if (formato === 'pdf') {
        const buffer = await inventarioExportService.generatePDF(id, req.tenantId);
        const filename = `inventario_${id}_${Date.now()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
      }
    } catch (err) { next(err); }
  }

  async exportCSV(req, res, next) {
    try {
      const allowed = ['admin', 'technician'];
      if (!allowed.includes(req.user?.role)) {
        throw new ApiError(403, 'No tiene permisos para exportar clientes', 'FORBIDDEN');
      }

      const { search } = req.query;
      const customers = await customerService.exportAll({ search }, req.tenantId);

      const csv = toCSV(customers);
      const bom = '\uFEFF';
      const timestamp = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="clientes_${req.tenantId}_${timestamp}.csv"`
      );
      res.send(bom + csv);
    } catch (err) {
      next(err);
    }
  }
}

export const customerController = new CustomerController();
