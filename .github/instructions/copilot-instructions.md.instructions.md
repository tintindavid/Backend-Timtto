---
applyTo: '**'
---
# GitHub Copilot Instructions - Mantenimiento Biomédico Backend

## 🎯 Contexto del Proyecto
Sistema backend API REST para mantenimiento biomédico, que gestiona equipos médicos, órdenes de trabajo, usuarios y reportes. Provee servicios a frontends web y servicios externos.


## 📋 Stack Tecnológico OBLIGATORIO
- Node.js v18+
- TypeScript 5.3+ (ES Modules)
- Express 4.18+
- MongoDB + Mongoose 8+
- JWT + bcryptjs
- Joi (validación)
- Winston (logging)

## 🏗️ Arquitectura del Proyecto
```
src/
 ├── config/          # Configuraciones (DB, env, logger)
 ├── models/          # Modelos Mongoose (*.model.js)
 ├── controllers/     # Controladores Express (*.controller.js)
 ├── services/        # Lógica de negocio (*.service.js)
 ├── services/external/ # Integraciones externas
 ├── routes/          # Rutas Express (*.routes.js)
 ├── dtos/            # Schemas Joi (*.dto.js)
 ├── middlewares/     # Middlewares
 ├── utils/           # Utilidades
 ├── types/           # Tipos javaScript/TypeScript
 ├── app.js           # Configuración Express
 └── server.js       # Entry point
```

## 🚨 REGLAS CRÍTICAS

### Fuente de Verdad
- **SIEMPRE** consultar `/docs/relacionTimtto.plantuml` antes de generar modelos
- **SIEMPRE** inventar campos que no existan en el PlantUML y que sean necesarios para la funcionalidad (solamente si es estrictamente necesario)
- **SIEMPRE** cambiar nombres o tipos de datos del PlantUML si no tienen sentido técnico (consultar con el equipo si es necesario)
- Si algo no es claro, dejar comentario `// TODO: Verificar con PlantUML`

### Separación de Responsabilidades
- **Controllers**: Solo orquestan, NO contienen lógica de negocio
- **Services**: Toda la lógica de negocio aquí
- **Routes**: Solo definen endpoints y aplican middlewares

### Soft Delete Obligatorio
TODAS las entidades deben incluir:
```javascript
isDeleted: { type: Boolean, default: false }
deletedAt: { type: Date, default: null }
```

### Validación SIEMPRE con Joi
- Validar ANTES de llegar al controller
- Un DTO por operación: `create*.dto.js`, `update*.dto.js`, `query*.dto.js`
- Usar middleware `validate(schema, 'body'|'query'|'params')`

### Formato de Respuesta Estándar
```javascript
// Success
{ success: true, message: "...", data: {} }

// Error
{ success: false, message: "...", error: { code: "...", details: {} } }
```

### JavaScript Estricto
- Usar `strict: true`
- NO usar `any` (usar `unknown` si es necesario)
- Definir interfaces para todas las entidades
- Usar path aliases: `@/config/*`, `@/models/*`, etc.

### Seguridad No Negociable
- CORS configurado con origins específicos
- Helmet para headers HTTP
- Rate limiting (100 req/15min)
- Sanitización con express-mongo-sanitize
- Passwords SIEMPRE hasheadas con bcryptjs
- JWT en header `Authorization: Bearer {token}`

### Logging por Ambiente
- **Development**: Console + debug level
- **Production**: DailyRotateFile + info level
- **NUNCA** loguear: passwords, tokens completos, datos sensibles

### Paginación Estándar
Query params para LIST:
```
?page=1&limit=10&sortBy=createdAt&order=desc&search=...
```
Response:
```json
{
  "data": [...],
  "pagination": {
    "page": 1, "limit": 10, "total": 100, "pages": 10,
    "hasNext": true, "hasPrev": false
  }
}
```

## 🔧 Convenciones de Código

### Nombres de Archivos
- Modelos: `user.model.js`, `equipment.model.js`
- Services: `user.service.js`, `equipment.service.js`
- Controllers: `user.controller.js`, `equipment.controller.js`
- Routes: `user.routes.js`, `equipment.routes.js`
- DTOs: `createUser.dto.js`, `updateUser.dto.js`
### Estructura de Funciones
```javascript
// Service example
export class UserService {
  async create(data: CreateUserDto): Promise<IUser> {
    // 1. Validaciones de negocio
    // 2. Lógica principal
    // 3. Logs
    // 4. Return
  }
}
```

### Manejo de Errores
```javascript
import { ApiError } from '@/utils/apiError.util';

throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
```

## 📦 Índices MongoDB
SIEMPRE definir índices necesarios en modelos:
```javascript
schema.index({ email: 1 }, { unique: true });
schema.index({ isDeleted: 1 });
schema.index({ createdAt: -1 });
```

## 🌍 Variables de Entorno
Consultar `.env.example` para variables disponibles.
NUNCA hardcodear valores sensibles.

## 📚 Documentación
- JSDoc en funciones públicas de services
- Comentarios inline solo cuando lógica es compleja
- TODO para funcionalidad pendiente

## 🚀 Endpoints Estándar por Entidad
```
POST   /api/v1/{entity}       - Create
GET    /api/v1/{entity}       - List (paginado)
GET    /api/v1/{entity}/:id   - GetById
PUT    /api/v1/{entity}/:id   - Update (completo)
PATCH  /api/v1/{entity}/:id   - Update (parcial)
DELETE /api/v1/{entity}/:id   - Soft Delete
```

## ⚡ Al Generar Código
1. Consultar PlantUML primero
2. Seguir arquitectura de capas estrictamente
3. Incluir validación Joi
4. Incluir manejo de errores
5. Incluir logs apropiados
6. Incluir comentarios JSDoc
7. Usar tipos JavaScript/TypeScript estrictos
8. Aplicar convenciones de nombres