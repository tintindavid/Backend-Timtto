import { addressService } from '../services/address.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class AddressController {
  async create(req, res, next) {
    try {
      const data = await addressService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Address creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await addressService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Addresss recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await addressService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Address recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await addressService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Address actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await addressService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Address eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const addressController = new AddressController();
