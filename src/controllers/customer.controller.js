import { logger } from '../config/logger.config.js';
import { customerService } from '../services/customer.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

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
}

export const customerController = new CustomerController();
