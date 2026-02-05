# API Conventions - Mantenimiento Biomédico Backend

Este documento define las convenciones estrictas para el diseño e implementación de la API REST.

---

## 🌐 Estructura de URLs

### Base URL
```
{protocol}://{host}:{port}/api/v{version}/{resource}
```

**Ejemplo:**
```
https://api.mantenimiento.com/api/v1/users
http://localhost:3000/api/v1/equipment
```

### Convenciones de Nombres
- **Recursos en plural**: `/users`, `/equipment`, `/maintenance-orders`
- **Kebab-case para URLs**: `/maintenance-orders`, `/work-orders`
- **Minúsculas siempre**: ❌ `/Users` ✅ `/users`
- **Sin verbos en URLs**: ❌ `/getUsers` ✅ `/users`
- **Sin trailing slash**: ❌ `/users/` ✅ `/users`

### Recursos Anidados
```
# Máximo 2 niveles de anidación
GET /api/v1/equipment/:equipmentId/maintenance-history
GET /api/v1/users/:userId/assigned-equipment

# Evitar:
❌ /api/v1/departments/:deptId/users/:userId/equipment/:equipId
```

---

## 🔀 Métodos HTTP

### CRUD Estándar

| Método | Endpoint | Acción | Respuesta |
|--------|----------|--------|-----------|
| `POST` | `/api/v1/users` | Crear usuario | `201 Created` + objeto |
| `GET` | `/api/v1/users` | Listar usuarios | `200 OK` + array + pagination |
| `GET` | `/api/v1/users/:id` | Obtener usuario | `200 OK` + objeto |
| `PUT` | `/api/v1/users/:id` | Actualizar completo | `200 OK` + objeto |
| `PATCH` | `/api/v1/users/:id` | Actualizar parcial | `200 OK` + objeto |
| `DELETE` | `/api/v1/users/:id` | Eliminar (soft) | `200 OK` + mensaje |

### Operaciones Especiales
```
# Acciones específicas (usar POST)
POST /api/v1/equipment/:id/calibrate
POST /api/v1/maintenance-orders/:id/approve
POST /api/v1/maintenance-orders/:id/reject
POST /api/v1/users/:id/reset-password

# Búsquedas complejas (usar POST si filtros son complejos)
POST /api/v1/equipment/search
POST /api/v1/reports/generate
```

---

## 📋 Query Parameters

### Paginación (OBLIGATORIA en LIST)
```
GET /api/v1/users?page=1&limit=10
```

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `page` | number | 1 | Número de página |
| `limit` | number | 10 | Items por página (max: 100) |
| `sortBy` | string | createdAt | Campo para ordenar |
| `order` | string | desc | `asc` o `desc` |

**Ejemplo:**
```
GET /api/v1/equipment?page=2&limit=20&sortBy=name&order=asc
```

### Búsqueda
```
GET /api/v1/users?search=juan
GET /api/v1/equipment?search=monitor
```
- Busca en campos de texto relevantes (name, description, code, etc.)
- Case-insensitive
- Búsqueda parcial (contiene)

### Filtros Específicos
```
# Filtro por estado
GET /api/v1/equipment?status=active

# Filtro por categoría
GET /api/v1/equipment?categoryId=507f1f77bcf86cd799439011

# Filtro por rango de fechas
GET /api/v1/maintenance-orders?startDate=2024-01-01&endDate=2024-12-31

# Múltiples filtros
GET /api/v1/equipment?status=active&categoryId=507f...&search=monitor
```

### Expansión de Relaciones (Populate)
```
# Traer datos relacionados
GET /api/v1/equipment?populate=category,location,assignedTo

# Sin populate (solo IDs)
{
  "_id": "...",
  "categoryId": "507f1f77bcf86cd799439011"
}

# Con populate
{
  "_id": "...",
  "category": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Monitores",
    "code": "MON"
  }
}
```

### Selección de Campos
```
# Traer solo campos específicos
GET /api/v1/users?fields=name,email,role

Response:
{
  "data": [
    { "name": "Juan", "email": "juan@example.com", "role": "admin" }
  ]
}
```

---

## 📦 Formato de Request

### Headers Obligatorios
```http
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

### Body (JSON)
```json
POST /api/v1/users
Content-Type: application/json

{
  "name": "Juan Pérez",
  "email": "juan@example.com",
  "password": "SecurePass123",
  "role": "technician"
}
```

### Convenciones de Campos
- **camelCase**: `firstName`, `equipmentCode`, `maintenanceType`
- **Fechas ISO 8601**: `"2024-01-15T10:30:00Z"`
- **ObjectIds**: `"507f1f77bcf86cd799439011"`
- **Booleans**: `true` / `false` (no strings)
- **Arrays vacíos**: `[]` (no null)
- **Valores nulos**: `null` (no undefined)

---

## 📤 Formato de Response

### Estructura Estándar SUCCESS
```json
{
  "success": true,
  "message": "Usuario creado exitosamente",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Juan Pérez",
    "email": "juan@example.com",
    "role": "technician",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Estructura con Paginación
```json
{
  "success": true,
  "message": "Usuarios recuperados exitosamente",
  "data": [
    { "_id": "...", "name": "Juan" },
    { "_id": "...", "name": "María" }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Estructura ERROR
```json
{
  "success": false,
  "message": "Email ya registrado",
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "details": {
      "field": "email",
      "value": "juan@example.com"
    }
  }
}
```

### Campos Excluidos en Responses
**NUNCA devolver:**
- ❌ `password`
- ❌ `passwordHash`
- ❌ `__v` (versión de Mongoose)
- ❌ `isDeleted` (a menos que sea explícitamente solicitado)
- ❌ `deletedAt` (a menos que sea explícitamente solicitado)

**Transformación en modelo:**
```typescript
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});
```

---

## 🔢 Códigos de Estado HTTP

### 2xx - Success
| Código | Descripción | Uso |
|--------|-------------|-----|
| `200 OK` | Éxito general | GET, PUT, PATCH, DELETE |
| `201 Created` | Recurso creado | POST |
| `204 No Content` | Éxito sin body | DELETE (alternativa) |

### 4xx - Client Errors
| Código | Descripción | Uso |
|--------|-------------|-----|
| `400 Bad Request` | Validación fallida | Datos inválidos, formato incorrecto |
| `401 Unauthorized` | No autenticado | Token ausente/inválido |
| `403 Forbidden` | No autorizado | Sin permisos |
| `404 Not Found` | No existe | Recurso no encontrado |
| `409 Conflict` | Conflicto | Email duplicado, estado inválido |
| `422 Unprocessable Entity` | Validación de negocio | Reglas de negocio fallidas |
| `429 Too Many Requests` | Rate limit | Límite de requests excedido |

### 5xx - Server Errors
| Código | Descripción | Uso |
|--------|-------------|-----|
| `500 Internal Server Error` | Error del servidor | Errores no controlados |
| `503 Service Unavailable` | Servicio no disponible | Mantenimiento, DB down |

### Ejemplos de Uso
```typescript
// 400 - Validación fallida
{
  "success": false,
  "message": "Datos de entrada inválidos",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "email": "Debe ser un email válido",
      "password": "Mínimo 8 caracteres"
    }
  }
}

// 401 - No autenticado
{
  "success": false,
  "message": "Token de autenticación inválido o expirado",
  "error": {
    "code": "INVALID_TOKEN"
  }
}

// 403 - No autorizado
{
  "success": false,
  "message": "No tienes permisos para realizar esta acción",
  "error": {
    "code": "FORBIDDEN",
    "details": {
      "required": "admin",
      "current": "user"
    }
  }
}

// 404 - No encontrado
{
  "success": false,
  "message": "Usuario no encontrado",
  "error": {
    "code": "USER_NOT_FOUND",
    "details": {
      "userId": "507f1f77bcf86cd799439011"
    }
  }
}

// 409 - Conflicto
{
  "success": false,
  "message": "El email ya está registrado",
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "details": {
      "email": "juan@example.com"
    }
  }
}

// 422 - Validación de negocio
{
  "success": false,
  "message": "No se puede eliminar un equipo con mantenimientos pendientes",
  "error": {
    "code": "EQUIPMENT_HAS_PENDING_MAINTENANCE",
    "details": {
      "pendingCount": 3
    }
  }
}
```

---

## 🔐 Autenticación y Autorización

### Header de Autenticación
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Endpoints Públicos
```
POST /api/v1/auth/login
POST /api/v1/auth/register
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
GET  /api/v1/health (health check)
```

### Endpoints Protegidos
Todos los demás endpoints requieren autenticación.

### Response 401 (Sin Token)
```json
{
  "success": false,
  "message": "Token de autenticación requerido",
  "error": {
    "code": "NO_TOKEN_PROVIDED"
  }
}
```

### Response 401 (Token Expirado)
```json
{
  "success": false,
  "message": "Token expirado. Por favor inicia sesión nuevamente",
  "error": {
    "code": "TOKEN_EXPIRED"
  }
}
```

---

## 🔍 Validación de Datos

### Reglas Generales
1. **Validar SIEMPRE** antes del controller con Joi
2. **Mensajes claros** en español para usuarios finales
3. **Detalles específicos** sobre qué campo falló
4. **Múltiples errores** en una sola respuesta

### Ejemplo de Error de Validación
```json
POST /api/v1/users
{
  "name": "A",
  "email": "invalid-email",
  "password": "123"
}

Response: 400 Bad Request
{
  "success": false,
  "message": "Errores de validación",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "name": "El nombre debe tener al menos 3 caracteres",
      "email": "Debe ser un email válido",
      "password": "La contraseña debe tener al menos 8 caracteres"
    }
  }
}
```

---

## 📊 Paginación - Especificación Completa

### Request
```
GET /api/v1/equipment?page=2&limit=20&sortBy=name&order=asc
```

### Response
```json
{
  "success": true,
  "message": "Equipos recuperados exitosamente",
  "data": [
    { "_id": "...", "name": "Monitor 1" },
    { "_id": "...", "name": "Monitor 2" }
  ],
  "pagination": {
    "page": 2,          // Página actual
    "limit": 20,        // Items por página
    "total": 156,       // Total de items
    "pages": 8,         // Total de páginas
    "hasNext": true,    // Hay página siguiente
    "hasPrev": true     // Hay página anterior
  }
}
```

### Links de Navegación (Opcional)
```json
{
  "pagination": {
    // ... campos anteriores
    "links": {
      "first": "/api/v1/equipment?page=1&limit=20",
      "prev": "/api/v1/equipment?page=1&limit=20",
      "self": "/api/v1/equipment?page=2&limit=20",
      "next": "/api/v1/equipment?page=3&limit=20",
      "last": "/api/v1/equipment?page=8&limit=20"
    }
  }
}
```

---

## 🕐 Formato de Fechas

### Input (Request)
```json
{
  "scheduledDate": "2024-01-15T10:30:00Z",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31"
}
```
- Siempre ISO 8601
- Preferir UTC (`Z` al final)
- Aceptar formato fecha simple (`YYYY-MM-DD`) cuando no se necesita hora

### Output (Response)
```json
{
  "createdAt": "2024-01-15T10:30:45.123Z",
  "updatedAt": "2024-01-20T15:22:10.456Z",
  "scheduledDate": "2024-02-01T08:00:00Z"
}
```
- Siempre ISO 8601 completo
- Siempre con milisegundos
- Siempre UTC

---

## 🔄 Versionamiento

### URL Versioning (Actual)
```
/api/v1/users
/api/v2/users  (cuando sea necesario)
```

### Deprecación
```http
GET /api/v1/equipment
Deprecation: true
Sunset: Sun, 01 Jan 2025 00:00:00 GMT
Link: </api/v2/equipment>; rel="successor-version"
```

### Breaking Changes
- **Crear nueva versión** de API
- **Mantener versión anterior** por al menos 6 meses
- **Documentar migración** en CHANGELOG.md

---

## 🚨 Manejo de Errores - Codes

### Códigos de Error Estándar
```typescript
// Autenticación
'INVALID_CREDENTIALS'
'INVALID_TOKEN'
'TOKEN_EXPIRED'
'NO_TOKEN_PROVIDED'
'FORBIDDEN'

// Validación
'VALIDATION_ERROR'
'INVALID_ID'
'MISSING_REQUIRED_FIELD'

// Recursos
'NOT_FOUND'
'ALREADY_EXISTS'
'CONFLICT'

// Negocio
'EQUIPMENT_IN_USE'
'EQUIPMENT_HAS_PENDING_MAINTENANCE'
'INVALID_STATUS_TRANSITION'
'INSUFFICIENT_PERMISSIONS'

// Sistema
'INTERNAL_ERROR'
'DATABASE_ERROR'
'EXTERNAL_SERVICE_ERROR'
```

---

## 🧪 Health Check

### Endpoint
```
GET /api/v1/health
```

### Response (Healthy)
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 86400,
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

### Response (Unhealthy)
```json
{
  "status": "error",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 86400,
  "version": "1.0.0",
  "services": {
    "database": "disconnected",
    "redis": "connected"
  }
}
```

---

## 📝 Logging de Requests

### Información a Loguear
```typescript
{
  "timestamp": "2024-01-15T10:30:00Z",
  "method": "POST",
  "url": "/api/v1/users",
  "statusCode": 201,
  "responseTime": 145, // ms
  "userId": "507f1f77bcf86cd799439011",
  "ip": "192.168.1.100",
  "userAgent": "PostmanRuntime/7.32.1"
}
```

### NO Loguear
- ❌ Passwords
- ❌ Tokens completos (solo últimos 4 caracteres)
- ❌ Datos sensibles (números de cuenta, etc.)

---

## 🔒 Rate Limiting

### Límites
```
100 requests / 15 minutos por IP
```

### Headers de Response
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1642248000
```

### Response 429
```json
{
  "success": false,
  "message": "Demasiadas solicitudes. Por favor intenta nuevamente en 15 minutos",
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "details": {
      "retryAfter": 900 // segundos
    }
  }
}
```

---

## 📚 Ejemplos Completos

### Crear Equipment
```http
POST /api/v1/equipment
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Monitor Signos Vitales",
  "code": "MSV-001",
  "serialNumber": "SN123456789",
  "categoryId": "507f1f77bcf86cd799439011",
  "locationId": "507f1f77bcf86cd799439012",
  "acquisitionDate": "2024-01-10",
  "status": "active"
}

Response: 201 Created
{
  "success": true,
  "message": "Equipo creado exitosamente",
  "data": {
    "_id": "507f1f77bcf86cd799439099",
    "name": "Monitor Signos Vitales",
    "code": "MSV-001",
    "serialNumber": "SN123456789",
    "category": {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Monitores"
    },
    "location": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "UCI - Piso 3"
    },
    "acquisitionDate": "2024-01-10T00:00:00Z",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Listar Equipment con Filtros
```http
GET /api/v1/equipment?page=1&limit=10&status=active&categoryId=507f...&search=monitor
Authorization: Bearer {token}

Response: 200 OK
{
  "success": true,
  "message": "Equipos recuperados exitosamente",
  "data": [
    {
      "_id": "507f1f77bcf86cd799439099",
      "name": "Monitor Signos Vitales",
      "code": "MSV-001",
      "status": "active"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

## ✅ Checklist de Implementación

Antes de considerar un endpoint completo, verificar:

- [ ] URL sigue convención de nombres (plural, kebab-case)
- [ ] Método HTTP correcto
- [ ] Validación Joi implementada
- [ ] Autenticación aplicada (si corresponde)
- [ ] Paginación implementada (para LIST)
- [ ] Respuesta sigue formato estándar
- [ ] Códigos HTTP correctos
- [ ] Manejo de errores completo
- [ ] Logs apropiados
- [ ] Campos sensibles excluidos de response
- [ ] Soft delete (no delete físico)
- [ ] Documentación en código (JSDoc)

---

## 🔄 Changelog

### v1.0.0 - 2024-01-15
- Versión inicial de convenciones API
- Definición de formato de response estándar
- Especificación de paginación
- Códigos de error y HTTP status