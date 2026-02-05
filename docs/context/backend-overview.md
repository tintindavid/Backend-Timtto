**Backend Overview**

Propósito
- API backend para la plataforma de mantenimiento biomédico (Timtto). Provee CRUD y servicios para equipos, órdenes de trabajo, repuestos, informes, protocolos y usuarios; pensada para consumo por frontends e integraciones.

Dominio funcional
- Gestión de activos/equipos biomédicos
- Órdenes de trabajo (OT) y hojas de trabajo
- Protocolos y actividades de mantenimiento
- Repuestos y trazabilidad
- Informes y reportes
- Gestión de usuarios y autenticación
- Soporte multitenant (shared DB mediante `tenantId`)

Stack tecnológico
- Node.js (ES Modules)
- Express
- MongoDB + Mongoose
- Joi para validación (DTOs)
- JWT para autenticación
- bcryptjs para hashing de contraseñas
- Winston + morgan para logging
- Seguridad: helmet, cors, express-mongo-sanitize, rate limiter

Arquitectura por capas
- Routes: definición de endpoints y aplicación de middlewares (src/routes)
- Controllers: orquestación de requests/responses, validaciones delegadas (src/controllers)
- Services: lógica de negocio, acceso a modelos (src/services)
- Models: esquemas Mongoose y hooks (src/models)
- DTOs: esquemas Joi por operación (src/dtos)
- Middlewares: autenticación, tenant resolution, validación, rate limiter, manejo de errores (src/middlewares)

Principios y convenciones clave
- Soft-delete: todas las entidades incluyen `isDeleted` y `deletedAt` y los `pre(/^find/)` filtran estos registros.
- Multitenancy (shared DB): todas las colecciones usan campo `tenantId` y índices compuestos por tenant (`{ tenantId:1, ... }`).
- Validación: Joi DTOs y middleware `validate(schema, 'body'|'query'|'params')` antes del controller.
- Autenticación: JWT en header `Authorization: Bearer <token>`; middleware `authenticate` valida y adjunta `req.user`.
- Formato de respuesta estándar: `successResponse(data, message, status, pagination)` y `errorResponse(message, code, details)`.
- Logging: distinto por ambiente; no loguear secretos.

Versionado de API
- Todas las rutas se montan bajo `/api/v1/*` (ver `src/app.js`). Actualmente la versión expuesta es `v1`.

Notas
- El sistema resuelve `tenantId` por prioridad: header `x-tenant-id` → claim JWT (`req.user.tenantId`) → body. Algunos endpoints (p. ej. creación de tenant) permiten pasar tenantId sin que exista aún.
