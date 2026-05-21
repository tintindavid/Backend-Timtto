'use strict';

import { roleService } from '../services/role.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class RoleController {
  async create(req, res, next) {
    try {
      const data = await roleService.create(req.tenantId, req.body);
      res.status(201).json(successResponse(data, 'Rol creado exitosamente', 201));
    } catch (error) {
      next(error);
    }
  }

  async list(req, res, next) {
    try {
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 10);
      const result = await roleService.list(req.tenantId, { page, limit });
      res.json(successResponse(result.data, 'Roles recuperados exitosamente', 200, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const data = await roleService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Rol recuperado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const data = await roleService.update(req.params.id, req.tenantId, req.body);
      res.json(successResponse(data, 'Rol actualizado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async softDelete(req, res, next) {
    try {
      await roleService.softDelete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Rol eliminado exitosamente'));
    } catch (error) {
      next(error);
    }
  }
}

export const roleController = new RoleController();