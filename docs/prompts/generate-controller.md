# Generate Controller

Genera un controller que orquesta pero NO contiene lógica de negocio:

## Estructura
```typescript
import { Request, Response, NextFunction } from 'express';
import { {entityName}Service } from '@/services/{entityName}.service';
import { successResponse } from '@/utils/apiResponse.util';

export class {EntityName}Controller {
  
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await {entityName}Service.create(req.body);
      res.status(201).json(successResponse(data, '{EntityName} creado exitosamente', 201));
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await {entityName}Service.list(filters, { page, limit, sortBy, order });
      res.json(successResponse(result.data, '{EntityName}s recuperados exitosamente', 200, result.pagination));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await {entityName}Service.getById(req.params.id);
      res.json(successResponse(data, '{EntityName} recuperado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await {entityName}Service.update(req.params.id, req.body);
      res.json(successResponse(data, '{EntityName} actualizado exitosamente'));
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await {entityName}Service.delete(req.params.id);
      res.json(successResponse(null, '{EntityName} eliminado exitosamente'));
    } catch (error) {
      next(error);
    }
  }
}

export const {entityName}Controller = new {EntityName}Controller();
```