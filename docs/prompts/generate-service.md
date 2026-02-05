# Generate Service

Genera un service completo con lógica de negocio:

## Input Requerido
- Nombre de la entidad
- Operaciones necesarias (create, list, getById, update, delete)

## Estructura
```typescript
import { {EntityName}, I{EntityName} } from '@/models/{entityName}.model';
import { ApiError } from '@/utils/apiError.util';
import { logger } from '@/config/logger.config';

export class {EntityName}Service {
  
  async create(data: any): Promise<I{EntityName}> {
    try {
      // Validaciones de negocio
      
      const entity = await {EntityName}.create(data);
      logger.info(`{EntityName} creado: ${entity._id}`);
      return entity;
    } catch (error) {
      logger.error('Error creando {entityName}:', error);
      throw new ApiError(500, 'Error creando {entityName}', 'CREATE_ERROR');
    }
  }

  async list(filters: any, pagination: any): Promise<any> {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = pagination;
      const skip = (page - 1) * limit;

      const query = { ...filters };
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

      const [data, total] = await Promise.all([
        {EntityName}.find(query).sort(sort).skip(skip).limit(limit),
        {EntityName}.countDocuments(query),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      logger.error('Error listando {entityName}s:', error);
      throw new ApiError(500, 'Error listando {entityName}s', 'LIST_ERROR');
    }
  }

  async getById(id: string): Promise<I{EntityName}> {
    try {
      const entity = await {EntityName}.findById(id);
      if (!entity) {
        throw new ApiError(404, '{EntityName} no encontrado', 'NOT_FOUND');
      }
      return entity;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error obteniendo {entityName}:', error);
      throw new ApiError(500, 'Error obteniendo {entityName}', 'GET_ERROR');
    }
  }

  async update(id: string, data: any): Promise<I{EntityName}> {
    try {
      const entity = await {EntityName}.findByIdAndUpdate(
        id,
        { $set: data },
        { new: true, runValidators: true }
      );
      
      if (!entity) {
        throw new ApiError(404, '{EntityName} no encontrado', 'NOT_FOUND');
      }
      
      logger.info(`{EntityName} actualizado: ${id}`);
      return entity;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error actualizando {entityName}:', error);
      throw new ApiError(500, 'Error actualizando {entityName}', 'UPDATE_ERROR');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const entity = await {EntityName}.findByIdAndUpdate(
        id,
        { $set: { isDeleted: true, deletedAt: new Date() } },
        { new: true }
      );
      
      if (!entity) {
        throw new ApiError(404, '{EntityName} no encontrado', 'NOT_FOUND');
      }
      
      logger.info(`{EntityName} eliminado (soft): ${id}`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error eliminando {entityName}:', error);
      throw new ApiError(500, 'Error eliminando {entityName}', 'DELETE_ERROR');
    }
  }
}

export const {entityName}Service = new {EntityName}Service();
```