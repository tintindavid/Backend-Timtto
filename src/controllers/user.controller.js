'use strict';
import { logger } from '../config/logger.config.js';
import { userService } from '../services/user.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class UserController {
  async create(req, res, next) {
    try {
      logger.info('Creando Usuario con datos desde controller', {
        tenantId: req.tenantId,
        data: req.body,
      });
      const body = { ...req.body, tenantId: req.tenantId };
      const data = await userService.create(body);
      res.status(201).json(successResponse(data, 'Usuario creado exitosamente', 201));
    } catch (error) {
      next(error);
    }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, search, name, email, role, roleId, hasFirma, permission, ...filters } = req.query;
      const result = await userService.list(
        filters,
        { page, limit, sortBy, order, search, name, email, role, roleId, hasFirma, permission },
        req.tenantId,
      );
      res.json(successResponse(result.data, 'Usuarios recuperados exitosamente', 200, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const data = await userService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Usuario recuperado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try { 
      const body = { ...req.body, tenantId: req.tenantId };
      const data = await userService.update(req.params.id, body);
      res.json(successResponse(data, 'Usuario actualizado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      await userService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Usuario eliminado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async assignRole(req, res, next) {
    try {
      const data = await userService.assignRole(req.params.id, req.body.roleId, req.tenantId);
      res.json(successResponse(data, 'Rol asignado exitosamente'));
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
