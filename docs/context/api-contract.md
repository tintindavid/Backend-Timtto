**API Contract (Resumen por endpoint)**

Nota: todas las rutas están montadas bajo el prefijo `/api/v1` (ver `src/app.js`). A continuación se enumeran los endpoints disponibles por recurso, método HTTP, esquema de request y respuesta. Para esquemas concretos de body ver los DTOs en `src/dtos`.

Formato de respuesta (éxito):
```json
{ "success": true, "message": "...", "data": { /* recurso */ }, "pagination": { /* opcional */ } }
```

Errores comunes:
- `400` Validation Error (código `VALIDATION_ERROR`)
- `401` Unauthorized (códigos `NO_TOKEN_PROVIDED`, `INVALID_TOKEN`)
- `404` Not Found (código `NOT_FOUND` o `TENANT_NOT_FOUND`)
- `409` Conflict (p. ej. `EMAIL_ALREADY_EXISTS`)
- `500` Internal Error (`INTERNAL_ERROR`)

-- Recursos y endpoints --

- Auth (`/api/v1/auth`)
  - POST `/register` — Registrar usuario.
    - Body: según `src/dtos/createUser.dto.js` (firstName, lastName, email, password, role...)
    - Publico; puede enviar header `x-tenant-id` o `tenantId` en body.
    - Response: `{ data: { user, token } }`.
  - POST `/login` — Login.
    - Body: `src/dtos/loginUser.dto.js` ({ email, password }).
    - Response: `{ data: { user, token } }`.
  - POST `/refresh-token` — Refrescar token.
    - Body: `{ token }`.
  - GET `/me` — Usuario actual.
    - Protegido: requiere `Authorization: Bearer <token>`.

- Users (`/api/v1/users`)
  - Todas las rutas usan `authenticate` (ver `src/routes/user.routes.js`).
  - POST `/` — Crear usuario. Body: `createUser.dto.js`.
  - GET `/` — Listar usuarios. Query: `page,limit,sortBy,order,search,role` (ver `queryUser.dto.js`).
  - GET `/:id` — Obtener usuario por id.
  - PUT `/:id` — Actualizar (full) (body `updateUser.dto.js`).
  - PATCH `/:id` — Actualizar (partial).
  - DELETE `/:id` — Soft delete.

- Tenants (`/api/v1/tenants`)
  - POST `/` — Crear tenant. Body: `src/dtos/createTenant.dto.js`.
  - GET `/` — Listar tenants (no auth en routes file).
  - GET `/:id` — Obtener tenant por tenantId.
  - PUT `/:id` — Actualizar tenant. Body: `src/dtos/updateTenant.dto.js`.
  - DELETE `/:id` — Soft delete tenant.

- Customers (`/api/v1/customers`)
  - Protegido (`authenticate`).
  - POST `/` — Crear (body `src/dtos/createCustomer.dto.js`).
  - GET `/` — Listado (query DTO `queryCustomer.dto.js`).
  - GET `/:id` — Obtener por id.
  - PUT/PATCH `/:id` — Actualizar.
  - DELETE `/:id` — Soft delete.

- Customer No Usar (`/api/v1/customer-no-usar`)
  - Misma estructura CRUD que `customers` (protegido).

- Address (`/api/v1/address`)
  - Protegido.
  - CRUD estándar (POST, GET list, GET/:id, PUT/PATCH/:id, DELETE/:id).

- Equipo Items (`/api/v1/equipo-items`)
  - Protegido. CRUD estándar.

- Estado Equipo (`/api/v1/estado-equipo`)
  - Protegido. CRUD estándar.

- HV Equipo (`/api/v1/hv-equipo`)
  - Protegido. CRUD estándar.

- Informes (`/api/v1/informes`)
  - Protegido. CRUD estándar.

- Items (`/api/v1/items`)
  - Protegido. CRUD estándar.

- OTs (`/api/v1/ots`)
  - Protegido. CRUD estándar.

- Protocolo Actividad (`/api/v1/protocolo-actividad`)
  - Protegido. CRUD estándar.

- Protocolo Mtto (`/api/v1/protocolo-mtto`)
  - Protegido. CRUD estándar.

- Reports (`/api/v1/reports`)
  - Protegido. CRUD estándar.

- Repuestos (`/api/v1/repuestos`)
  - Protegido. CRUD estándar.

- Repuesto Trazabilidad (`/api/v1/repuesto-trazabilidad`)
  - Protegido. CRUD estándar.

- Sedes (`/api/v1/sedes`)
  - Protegido. CRUD estándar.

- Servicios (`/api/v1/servicios`)
  - Protegido. CRUD estándar.

- SheetWork (`/api/v1/sheetwork`)
  - Protegido. CRUD estándar.

- Usuario (`/api/v1/usuario`)
  - Protegido. CRUD estándar (similar a `users` pero modelo `Usuario`).

-- Notas adicionales por consumo de frontend --
- `tenantId`: siempre que sea aplicable, enviar `x-tenant-id` header para seleccionar el tenant; si el token incluye `tenantId` será usado por `tenantResolver`.
- Validaciones: las dto (Joi) aplicadas en rutas controlan shape y tipos; respuesta de validación llega con `400` y `error.details` contenida en `error` del response.
- Paginación: incluir `page` y `limit` en query; la respuesta añade `pagination`.

Si necesitas un contrato OpenAPI/Swagger más detallado por endpoint (campos de request/response por modelo), puedo generar un spec basado en los DTOs y modelos; dime si lo quieres en YAML o JSON.
