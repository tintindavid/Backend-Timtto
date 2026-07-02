# [2.0.0](https://github.com/tintindavid/Backend-Timtto/compare/v1.3.1...v2.0.0) (2026-07-02)


* feat(security)!: cross-tenant isolation baseline (E0) ([c8dfb70](https://github.com/tintindavid/Backend-Timtto/commit/c8dfb707ced244993e9fd259b238fdd184e6bd8d))


### BREAKING CHANGES

* POST /api/v1/auth/register retirada (retorna 410 Gone).
Migrar a POST /api/v1/users (autenticado como admin del tenant) o al
seed script para el bootstrap del primer admin.
* POST /api/v1/tenants ahora requiere role='superadmin'.
Antes era público, permitiendo signup no autenticado.
* PUT/DELETE /api/v1/tenants/:id ahora exigen match del
tenant propio o role='superadmin'. Antes cualquier usuario autenticado
podía modificar/eliminar cualquier tenant (IDOR cross-tenant).
* Users con tenantId='superadmin'|'SUPERADMIN' ya no son
reconocidos como SuperAdmin. Correr scripts/migrate-superadmin-users.js
en staging + producción antes del deploy.

Ref: openspec/changes/saas-security-baseline
Ref: ai-specs/changes/saas-evolution/{00-discovery,01-brainstorming,02-gap-analysis,03-roadmap}.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# [2.0.0] — saas-security-baseline (E0) (2026-07-01)

### BREAKING CHANGES

* **auth:** `POST /api/v1/auth/register` is retired. The route remains registered but now returns `410 Gone`. Consumers must migrate to `POST /api/v1/users` (authenticated, admin role required). Use the `seed-platform-superadmin.js` script for bootstrapping.
* **tenants:** `POST /api/v1/tenants` now requires `authenticate + requireSuperAdmin`. Previously it was a public endpoint.
* **tenants:** `GET /api/v1/tenants` now requires `authenticate + requireSuperAdmin`. Previously any authenticated user could list all tenants.
* **tenants:** `DELETE /api/v1/tenants/:id` now requires `requireSuperAdmin`. Previously any authenticated user could delete tenants.
* **tenant.middleware:** `tenantId` from `req.body` is no longer read. Clients relying on `body.tenantId` as a fallback must migrate to the `x-tenant-id` header.
* **superadmin:** SuperAdmin identification is now exclusively `req.user.role === 'superadmin'`. JWTs with the old `tenantId='superadmin'|'SUPERADMIN'` sentinel must be refreshed after running `migrate-superadmin-users.js`.

### Features

* **auth:** `POST /api/v1/auth/refresh-token` now preserves `tenantId` in the new JWT payload (previously lost on refresh).
* **user.role:** enum extended with `'superadmin'`. SuperAdmins carry `tenantId='__platform__'`.
* **tenant.model:** `tenantId` field now applies `lowercase: true` at schema level — case-insensitive lookups replaced by exact match on a normalized value.
* **tenant.routes:** all legacy `/api/v1/tenants/*` responses include `Deprecation: true`, `Sunset` and `Link` headers pointing to the future `/api/v1/platform/tenants` (E1).
* **middlewares:** new `requireTenantMatch` middleware — allows `GET /:id` and `PUT /:id` only to the owning tenant or a superadmin.
* **scripts:** one-off migration scripts `migrate-superadmin-users.js` and `normalize-tenant-ids.js` added to `scripts/`.
* **scripts:** idempotent `seed-platform-superadmin.js` added to `scripts/`.
* **tests:** isolation test suite added to `tests/isolation/` covering customers, equipoitems, ots, reports, and users.

---

# [1.3.0](https://github.com/tintindavid/Backend-Timtto/compare/v1.2.0...v1.3.0) (2026-06-29)


### Features

* **services:** add ticket services module ([24a3904](https://github.com/tintindavid/Backend-Timtto/commit/24a3904b31899769b87eba645abe9661e8f49811))

# [1.2.0](https://github.com/tintindavid/Backend-Timtto/compare/v1.1.0...v1.2.0) (2026-05-29)


### Features

* **services:** expand cantidad servicio in select ([3730700](https://github.com/tintindavid/Backend-Timtto/commit/37307003b98a717f8e4481e369230e742a50e98a))

# [1.1.0](https://github.com/tintindavid/Backend-Timtto/compare/v1.0.0...v1.1.0) (2026-05-26)


### Features

* **reports:** add verificationParam capture and PDF section (SCRUM-5) ([842b1c2](https://github.com/tintindavid/Backend-Timtto/commit/842b1c25765cf755bec23e8788fca32eb56705ca))

# 1.0.0 (2026-05-26)


### Features

* agregar carga y gestion de evidencias en reportes (SCRUM-4) ([561ff06](https://github.com/tintindavid/Backend-Timtto/commit/561ff064163001b2af9a7aaf7f1e3fca450dcbfe))
* **cronograma:** refactor downloadCronogramaPDF to fetch equipo data server-side using clienteId ([155494d](https://github.com/tintindavid/Backend-Timtto/commit/155494d8d69e12452b8f02fcf07328ce88e624eb))
* **TICKET-001:** add customer inventory download endpoint (Excel/PDF) ([1018632](https://github.com/tintindavid/Backend-Timtto/commit/1018632f06d2aabaa016b6b1a691c89761e96003))
