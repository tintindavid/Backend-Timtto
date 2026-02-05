# Generate Routes

Genera archivo de rutas con middlewares:

## Estructura
```typescript
import { Router } from 'express';
import { {entityName}Controller } from '@/controllers/{entityName}.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { validate } from '@/middlewares/validate.middleware';
import { 
  create{EntityName}Dto, 
  update{EntityName}Dto, 
  query{EntityName}Dto 
} from '@/dtos/{entityName}.dto';

const router = Router();

// Aplicar autenticación a todas las rutas
router.use(authenticate);

// POST - Create
router.post(
  '/',
  validate(create{EntityName}Dto, 'body'),
  {entityName}Controller.create
);

// GET - List
router.get(
  '/',
  validate(query{EntityName}Dto, 'query'),
  {entityName}Controller.list
);

// GET - GetById
router.get(
  '/:id',
  {entityName}Controller.getById
);

// PUT - Update (completo)
router.put(
  '/:id',
  validate(update{EntityName}Dto, 'body'),
  {entityName}Controller.update
);

// PATCH - Update (parcial)
router.patch(
  '/:id',
  validate(update{EntityName}Dto, 'body'),
  {entityName}Controller.update
);

// DELETE - Soft Delete
router.delete(
  '/:id',
  {entityName}Controller.delete
);

export default router;
```