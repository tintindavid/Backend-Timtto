# TimttoApp — Backend Mantenimiento Biomédico

Descripción
-----------
TimttoApp es una API REST para gestión de mantenimiento biomédico: equipos, órdenes de trabajo (OT), usuarios, reportes y repuestos. Está organizada en capas (models, services, controllers, routes) y utiliza MongoDB/Mongoose, JWT para autenticación y Joi para validación.

Requisitos previos
------------------
- Node.js v18 o superior
- npm
- MongoDB accesible (local o remoto)

Instalación
----------
```bash
git clone <repo-url>
cd TimttoApp
npm install
cp .env.example .env
# Edita .env según tu entorno
npm run dev
```

Configuración de .env
---------------------
Copia `.env.example` a `.env` y ajusta las variables críticas:

- `PORT` — puerto de la API (ej. 3000)
- `NODE_ENV` — development|production
- `MONGO_URI` — URI de conexión a MongoDB
- `JWT_SECRET` — secreto para firmar JWT
- `JWT_EXPIRES_IN` — expiración de token (ej. 7d)
- `CORS_ORIGINS` — orígenes permitidos (coma-separados)
- `RATE_LIMIT_WINDOW_MS` y `RATE_LIMIT_MAX` — rate limiter
- `LOG_LEVEL` — nivel de logs (debug|info|warn|error)

Comandos disponibles
--------------------
- `npm run dev` — arranca la app en modo desarrollo (ejecuta `src/server.js`)
- `npm run build` — compilar (TypeScript projects)
- `npm start` — iniciar la versión build
- `npm run lint` — ejecutar ESLint
- `npm run format` — aplicar Prettier

Estructura del proyecto
-----------------------
- `src/`
  - `config/` — configuración (env, logger, database)
  - `models/` — modelos Mongoose
  - `dtos/` — esquemas Joi para validación
  - `services/` — lógica de negocio
  - `controllers/` — orquestación de peticiones
  - `routes/` — definiciones de endpoints
  - `middlewares/` — auth, validate, error, rateLimiter
  - `utils/` — jwt, password, responses, ApiError
  - `app.js` — configuración Express (middlewares, rutas)
  - `server.js` — entrypoint y conexión a MongoDB

Scripts de plataforma (one-off / migrations)
--------------------------------------------

Run from `TimttoApp/`:

```bash
# 1. Migrate legacy sentinel users (tenantId='superadmin'|'SUPERADMIN') to role='superadmin', tenantId='__platform__'
MONGO_URI=mongodb://... node scripts/migrate-superadmin-users.js

# 2. Normalize all tenantId fields to lowercase in every collection
MONGO_URI=mongodb://... node scripts/normalize-tenant-ids.js

# 3. Seed the first platform SuperAdmin (idempotent)
MONGO_URI=mongodb://... \
SEED_SUPERADMIN_EMAIL=ops@timtto.com \
SEED_SUPERADMIN_PASSWORD=ChangeMe123! \
node scripts/seed-platform-superadmin.js
```

Run order for a fresh deployment:
  1. `migrate-superadmin-users.js` — must run before `normalize-tenant-ids.js`
  2. `normalize-tenant-ids.js`
  3. `seed-platform-superadmin.js`

All scripts are idempotent and require `MONGO_URI` to be set. Verify on staging first.

Endpoints principales
--------------------
- Autenticación
  - POST /api/v1/auth/register — RETIRADO (E0). Responde 410 Gone. Usar POST /api/v1/users (autenticado).
  - `POST /api/v1/auth/login` — login, devuelve JWT
  - `POST /api/v1/auth/refresh-token` — refrescar token (preserva userId, role, tenantId)
  - `GET  /api/v1/auth/me` — obtener usuario actual (protegido)

- Usuarios
  - `POST   /api/v1/users`
  - `GET    /api/v1/users`
  - `GET    /api/v1/users/:id`
  - `PUT    /api/v1/users/:id`
  - `PATCH  /api/v1/users/:id`
  - `DELETE /api/v1/users/:id` (soft delete)

- Health
  - `GET /api/v1/health`

Además, el generador de CRUD creó rutas montadas en `src/app.js` para las entidades del PlantUML, por ejemplo: `/api/v1/servicios`, `/api/v1/sedes`, `/api/v1/ots`, `/api/v1/repuestos`, `/api/v1/protocolo-mtto`, `/api/v1/protocolo-actividad`, `/api/v1/hv-equipo`, etc.

Seguridad y convenciones
------------------------
- JWT en header: `Authorization: Bearer {token}` (ver `src/middlewares/auth.middleware.js`)
- Passwords hasheadas con bcrypt (`src/utils/password.util.js`)
- Validación con Joi y middleware `validate(schema, 'body'|'query'|'params')`
- Soft delete obligatorio: `isDeleted`, `deletedAt`
- Rate limiting, Helmet, express-mongo-sanitize y CORS ya configurados en `src/app.js`
- Formato de respuesta estándar: `{ success: true|false, message, data?, error? }`

Ejemplos de uso
---------------
1) Registrar
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Juan","lastName":"Pérez","email":"juan@example.com","password":"Secret123"}'
```

2) Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"juan@example.com","password":"Secret123"}'
# Response contiene `token` -> usar en Authorization header
```

3) Listar usuarios (paginado)
```bash
curl -H "Authorization: Bearer {token}" "http://localhost:3000/api/v1/users?page=1&limit=10&sortBy=createdAt&order=desc"
```

Notas finales
------------
- Revisa `docs/relacionTimtto.plantuml` antes de ajustar o generar modelos adicionales.
- Los DTOs generados por el script son plantillas; debes completarlos con reglas de negocio precisas.

Si quieres, puedo:
- ajustar/añadir más ejemplos concretos de endpoints
- generar documentación OpenAPI/Swagger básica a partir de las rutas
- crear scripts de prueba de integración básicos

CORS (desarrollo)
------------------
- Durante desarrollo el backend permite peticiones desde `http://localhost:5173` (Vite) y `http://localhost:3000` cuando `NODE_ENV=development`.
- La configuración usa la librería `cors` con `credentials: true`, permite `GET, POST, PUT, DELETE, OPTIONS` y los headers `Content-Type` y `Authorization`.
 - La configuración usa la librería `cors` con `credentials: true`, permite `GET, POST, PUT, DELETE, OPTIONS` y los headers `Content-Type`, `Authorization` y `x-tenant-id` (necesario para el header personalizado del frontend).
- En producción establece `CORS_ORIGINS` en el `.env` con los orígenes autorizados.

Email notifications (E3)
------------------------
El backend puede enviar emails transaccionales via Resend SMTP (dominio `timtto.com`).

**Estado por defecto**: desactivado (`NOTIFICATIONS_ENABLED=false`). Activar solo tras verificar deliverability con `scripts/test-resend-smoke.mjs`.

**Variables de entorno requeridas** (cuando el flag está `true`):
```
NOTIFICATIONS_ENABLED=true
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_xxxxxxxxxxxxxxxxxxxxxx     # Resend API key
EMAIL_FROM_ADDRESS=AlertasyNotificaciones@timtto.com
EMAIL_FROM_NAME=TIMTTO Alertas y Notificaciones
PUBLIC_APP_URL=https://app.timtto.com       # base URL del frontend, usado en el link del email
```

**Setup one-time**:
1. Sign up en Resend y agregar `timtto.com` como dominio.
2. Agregar los 3-4 DNS records (SPF, DKIM, MX return-path, DMARC opcional) en Namecheap.
3. Esperar propagación (~5 min) y verificar ✅ Verified en Resend.
4. Generar API key con permiso "Sending access" en Resend.
5. Configurar env vars en Railway (o `.env` local para dev).

**Smoke test de credenciales** (sin depender del código de la app):
```bash
node scripts/test-resend-smoke.mjs tu-email@example.com
```
El script llama la REST API de Resend y confirma HTTP 200 + Message ID si la config está correcta.

**Flujos con email en E3**:
- **Welcome tenant admin**: al crear un tenant nuevo, el primer admin recibe email con credenciales.
- **Password reset cross-tenant**: al resetear la password de un user desde `/admin/users`, el user recibe email con la nueva temp password.

Ambos flujos son fail-silent — un error de email nunca rompe la creación de tenant ni el reset. El modal de UI sigue mostrando la password como fallback defensivo.

Ver `openspec/changes/saas-notifications-baseline/` para spec completa.
