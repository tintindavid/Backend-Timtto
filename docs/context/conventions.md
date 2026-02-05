**Conventions**

- Convención de nombres:
  - Rutas base: `/api/v1/{resource}`; los archivos de rutas están en `src/routes`.
  - Modelos: `PascalCase` export (p. ej. `User`, `Tenant`) y colecciones explícitas en `collection`.
  - DTOs: `createX.dto.js`, `updateX.dto.js`, `queryX.dto.js` en `src/dtos`.

- Formato de fechas: JavaScript `Date` (ISO 8601 cuando se envía por JSON). Los esquemas Mongoose usan `timestamps: true`.

- Paginación estándar:
  - Query params: `?page=1&limit=10&sortBy=createdAt&order=desc&search=...`
  - Respuesta incluye `pagination` con: `page`, `limit`, `total`, `pages`, `hasNext`, `hasPrev`.

- Filtros comunes:
  - Búsqueda por `search` aplicada en servicios cuando corresponde (generalmente usa expresiones regulares `i`).
  - Los `pre(/^find/)` de los modelos filtran por `isDeleted:false` por defecto.

- Formato estándar de respuesta API:
  - Éxito:
    {
      "success": true,
      "message": "...",
      "data": { ... },
      "pagination": { ... } // opcional
    }
  - Error:
    {
      "success": false,
      "message": "...",
      "error": { "code": "...", "details": {...} }
    }

- Manejo de errores:
  - Se utiliza `ApiError` para errores controlados con `statusCode`, `code` y `details`.
  - Middleware global `errorHandler` transforma `ApiError` a `errorResponse` y devuelve el `statusCode`.

- Seguridad / headers:
  - `Helmet` y `cors` configurado en `src/app.js`.
  - Sanitización de inputs con `express-mongo-sanitize`.

Notas y dudas abiertas
- Algunas colecciones exponen muchos campos con nombres en mezcla de idioma/estilo (p. ej. `Report`, `Informe`, `Usuario`) — frontend debe consultar el modelo exacto en `src/models` para el campo concreto.
