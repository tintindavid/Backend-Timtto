**Authentication Flow**

Resumen
- El backend usa JWT para autenticar requests. El flujo principal es: registro/login → obtención de token JWT → enviar token en `Authorization` para endpoints protegidos.

Endpoints relevantes
- `POST /api/v1/auth/register` — registra un usuario. Valida contra `createUser.dto.js`. Puede aceptar `x-tenant-id` header o `tenantId` en body; `tenantId` se prioriza según `tenantResolver`.
- `POST /api/v1/auth/login` — login con `email` y `password` (ver `src/dtos/loginUser.dto.js`).
- `POST /api/v1/auth/refresh-token` — recibe `{ token }` en body y devuelve un token nuevo.
- `GET /api/v1/auth/me` — protegido por `authenticate`, devuelve información del usuario autenticado.

Estructura del JWT
- Generación: `signToken(payload)` en `src/utils/jwt.util.js`.
- Payload observado en el código (login/register): `{ userId, role, tenantId }`.
- Verificación: `verifyToken` lanza `ApiError(401, 'INVALID_TOKEN')` si es inválido o expirado.

Headers
- `Authorization: Bearer <token>` — requerido por middleware `authenticate` en rutas protegidas.
- `x-tenant-id: <tenantId>` — usado por `tenantResolver` para resolver contexto multitenant. Prioridad: header → token → body.

Expiración
- El tiempo de expiración está en la variable de entorno `JWT_EXPIRES_IN` (por defecto `7d` en `src/config/env.js`).

Rutas protegidas
- Cualquier ruta que llame `router.use(authenticate)` en sus archivos de rutas requiere token válido. Ejemplos: `/api/v1/users`, `/api/v1/customers`, `/api/v1/ots`, etc. Revisar `src/routes` para la lista completa.

Comportamiento en errores
- Si falta header de autorización o es mal formado: `401` con código `NO_TOKEN_PROVIDED`.
- Si token inválido o expirado: `401` con código `INVALID_TOKEN`.

Notas de implementación
- `authenticate` pone el payload decodificado en `req.user`.
- `tenantResolver` puede usar `req.user.tenantId` cuando está presente; en endpoints de creación de tenant se permite pasar un `tenantId` que aún no exista.
