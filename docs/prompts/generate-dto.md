# Generate DTOs (Validation Schemas)

Genera schemas Joi para validación:

## Estructura
```typescript
import Joi from 'joi';

// Create DTO
export const create{EntityName}Dto = Joi.object({
  // Definir campos con validaciones apropiadas
  // Ejemplo:
  // name: Joi.string().required().min(3).max(100),
  // email: Joi.string().email().required(),
  // age: Joi.number().integer().min(0).max(120),
  // isActive: Joi.boolean().default(true),
  // categoryId: Joi.string().regex(/^[0-9a-fA-F]{24}$/, 'ObjectId válido'),
});

// Update DTO (campos opcionales)
export const update{EntityName}Dto = Joi.object({
  // Mismos campos pero opcionales (.optional())
});

// Query DTO (para filtros en LIST)
export const query{EntityName}Dto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'name').default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().optional(),
  // Agregar filtros específicos de la entidad
});
```

## Validaciones Comunes
- Strings: `.min()`, `.max()`, `.email()`, `.pattern()`
- Numbers: `.integer()`, `.min()`, `.max()`
- Dates: `.date()`, `.iso()`
- ObjectId: `.string().regex(/^[0-9a-fA-F]{24}$/)`
- Enums: `.valid('valor1', 'valor2')`