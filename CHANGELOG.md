# [2.3.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.2.1...v2.3.0) (2026-07-03)


### Bug Fixes

* **analytics:** use preserveNullAndEmptyArrays (correct $unwind option) ([4a56bc1](https://github.com/tintindavid/Backend-Timtto/commit/4a56bc13f54d267b4995929421a3a4f14c5e9ce3))


### Features

* **platform:** analytics dashboard with cross-tenant KPIs (E4) ([d70cb77](https://github.com/tintindavid/Backend-Timtto/commit/d70cb7730f38f529580c9e9d518354725e1e4ae4))

# [Unreleased] — saas-platform-analytics (E4)

### Features

* **Platform Analytics dashboard (SuperAdmin):** 3 new read-only endpoints under `/api/v1/platform/analytics/*`:
  - `GET /platform/analytics` — returns 6 global metrics in a single response: tenantStats (by status), userStats (by role), equipoTotal, otStats (by estado + byType breakdown), otsPerTenant (top-20 open OTs per tenant), equiposTimeline (monthly equipo creations). Filters `from`/`to` apply only to time-based metrics; tenant/user counts always reflect current state.
  - `GET /platform/analytics/tenants` — per-tenant breakdown array with 10 columns: tenantId, tenantName, status, plan, createdAt, usersCount, equiposCount, otsOpen, otsClosed, reportsCount. `includeDeleted=true` includes soft-deleted tenants.
  - `GET /platform/analytics/tenants.csv` — same dataset as above, streamed as a UTF-8 CSV with BOM prefix for correct Excel rendering of Spanish accented characters. RFC 4180 escaping applied.
* **csvBuilder util:** New `src/utils/csvBuilder.util.js` — lightweight RFC 4180 CSV builder; no external dependencies.
* **analyticsQuery DTO:** New `src/dtos/analyticsQuery.dto.js` — Joi validation for `from`/`to` ISO dates with cross-field guard (`to >= from`) and `includeDeleted` boolean.

### No migrations, no new env vars, no BREAKING CHANGES

All aggregations run fresh on every request (no cache). With 2–10 tenants, latency is <200 ms. Follow-up: add TTL cache if tenant count grows beyond 100.

---

## [2.2.1](https://github.com/tintindavid/Backend-Timtto/compare/v2.2.0...v2.2.1) (2026-07-03)


### Bug Fixes

* **notifications:** fire-and-forget email so response is not blocked ([5ad13f9](https://github.com/tintindavid/Backend-Timtto/commit/5ad13f90aaf2d4709acc0c23f00a19b95fd6bd24)), closes [#14](https://github.com/tintindavid/Backend-Timtto/issues/14)

# [2.2.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.1.0...v2.2.0) (2026-07-03)


### Features

* **notifications:** transactional emails via Resend SMTP (E3) ([f6590ac](https://github.com/tintindavid/Backend-Timtto/commit/f6590ac44c2e39826369808c7e478f4461bea41a))

# [Unreleased] — saas-notifications-baseline (E3)

### Features

* **email notifications (Resend SMTP):** New `services/external/email.service.js` sends transactional emails via Resend on custom domain `timtto.com`. Two flows covered in MVP:
  - **Welcome tenant admin:** `POST /api/v1/platform/tenants` now sends a welcome email to the first admin with tenant name, tenantId, email, temporary password, and login URL. Response envelope adds `emailSent: boolean`.
  - **Password reset:** `POST /api/v1/platform/users/:userId/reset-password` now sends the new temporary password by email. Response adds `emailSent: boolean`.
* **Handlebars templates:** 4 templates in `src/templates/email/` — welcome + reset, each in HTML + plain-text fallback. Rendered on-demand with in-memory cache via `utils/renderTemplate.util.js`.
* **Feature-flagged rollout:** All email sending is guarded by `NOTIFICATIONS_ENABLED=true`. Default is `false` — deploy is completely safe (no behaviour change) until the flag is activated.
* **Defensive modal:** Frontend `CredentialsShownOnce` and `UserPasswordResetModal` still display the temporary password. When `emailSent=true`, they additionally show an info banner "también enviado por email a X" so the operator can rely on the email OR fall back to manual sharing.
* **Fail-silent design:** Email failures never break the parent flow. Errors are logged with metadata only (`{ to, templateName, error.message }`); `html`, `text`, and `temporaryPassword` are never logged. `emailSent` in the response signals "intent accepted by SMTP" not "delivered".

### New environment variables

Required only when `NOTIFICATIONS_ENABLED=true`:

- `SMTP_HOST` (default `smtp.resend.com`)
- `SMTP_PORT` (default `465`, SSL direct)
- `SMTP_USER` (default `resend`)
- `SMTP_PASSWORD` (Resend API key starting with `re_...`)
- `EMAIL_FROM_ADDRESS` (default `AlertasyNotificaciones@timtto.com`)
- `EMAIL_FROM_NAME` (default `TIMTTO Alertas y Notificaciones`)
- `PUBLIC_APP_URL` (used for the login link in emails; e.g. `https://app.timtto.com` or your Railway frontend URL)

### Dependencies

* Added `nodemailer ^6.9.0` and `handlebars ^4.7.8`.

### Deployment note

**Deploy with `NOTIFICATIONS_ENABLED=false` (default).** Verify all SMTP env vars are set in Railway. Activate the flag only after a manual test using `scripts/test-resend-smoke.mjs`. See README section "Email notifications" for full setup.

---

# [Unreleased] — saas-platform-support-tools (E2)

### Features

* **platform/users:** New `GET /api/v1/platform/users` (paginated cross-tenant user list, filters: tenantId, role, email) and `POST /api/v1/platform/users/:userId/reset-password` (generates cryptographically secure temp password, sets `mustChangePassword=true`, returns plain password ONE TIME). Requires `authenticate + requireSuperAdmin`.
* **platform/audit-log:** New `GET /api/v1/platform/audit-log` (paginated, filters: actorUserId, action, targetTenantId, from/to). New `PlatformAuditLog` collection with 2-year TTL index.
* **platform/view-as:** New `POST /api/v1/platform/view-as` (validates tenant, returns info for frontend banner) and `DELETE /api/v1/platform/view-as` (signals exit). Audit entries written post-response.
* **auth/change-password:** New `POST /api/v1/auth/change-password` (authenticated, body: `{ currentPassword, newPassword }`). Verifies current password, clears `mustChangePassword`, returns fresh JWT.
* **auth/login:** Response now includes `mustChangePassword: boolean` so the frontend can redirect immediately after login.
* **auditPlatformAction middleware:** Global post-response middleware that writes `PlatformAuditLog` entries for all successful mutations on `/api/v1/platform/*`. Fail-silent (errors logged, never thrown). Captures before/after document snapshots.
* **enforceReadOnlyForSuperadmin middleware:** Global guard that blocks POST/PUT/PATCH/DELETE from `role='superadmin'` on any domain route outside `/platform/*` and `/auth/*`. Bypassed by env flag `SUPERADMIN_READONLY=off` for development.
* **enforceMustChangePassword middleware:** Global guard that returns 428 `MUST_CHANGE_PASSWORD` for authenticated users with `mustChangePassword=true` on any route except `/auth/change-password`, `/auth/logout`, `/auth/refresh-token`.

### BREAKING (internal — no external API contract change)

* **superadmin role:** Users with `role='superadmin'` can no longer execute POST/PUT/PATCH/DELETE on domain routes (customers, OTs, reports, equipos, etc.). All SuperAdmin writes must go through `/api/v1/platform/*` endpoints. This is enforced by `enforceReadOnlyForSuperadmin` middleware.
  - Mitigation: set `SUPERADMIN_READONLY=off` in `.env` if internal scripts rely on the old behaviour (temporary, fix scripts to use platform endpoints).

### Deployment note

**Deploy with `SUPERADMIN_READONLY=strict` (default).** Verify no internal tooling uses superadmin for domain writes before activating in production. See ADR-013 in `constitution.md`.

---

# [2.1.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.0.1...v2.1.0) (2026-07-02)


### Features

* **platform:** tenant lifecycle console + status enforcement (E1) ([d5d18f3](https://github.com/tintindavid/Backend-Timtto/commit/d5d18f3ebabd15b130236fbbadb39b0b211d239b))

# [Unreleased] — saas-platform-tenant-lifecycle (E1)

### Features

* **platform/tenants:** New endpoints `POST|GET|PUT|PATCH|DELETE /api/v1/platform/tenants/*` for SuperAdmin tenant lifecycle management (create with first admin, list, detail with counters, update metadata, suspend, reactivate, soft-delete).
* **my-tenant:** New `GET /api/v1/my-tenant` (any authenticated user) and `PUT /api/v1/my-tenant` (admin role only) replace the legitimate use of `GET /api/v1/tenants/:id`.
* **user.model:** Added `mustChangePassword: Boolean (default: false)` — activated for first-admin users created via onboarding wizard; E2 will enforce rotation on next login.
* **tenant.middleware:** `ENFORCE_TENANT_STATUS` feature flag (env var, default `false`) — when `true`, `tenantResolver` blocks requests to non-platform routes with 403 `TENANT_SUSPENDED` or `TENANT_CLOSED` for inactive tenants.
* **requireRole:** New `requireRole(...roles)` middleware factory for role-based access control on individual routes.
* **temporaryPassword:** New `generateTemporaryPassword(length)` util — cryptographically secure, ≥12 chars, guarantees uppercase + lowercase + digit + symbol.

### BREAKING (delayed — follow-up PR)

* **tenants legacy:** `/api/v1/tenants/*` routes will change from `Deprecation` headers to `410 Gone` at the end of the 30-day grace period from E0 merge. **No action required in this release.**

### Deployment note

**Deploy `ENFORCE_TENANT_STATUS=false` (default).** Activate to `true` only after 7-day observation window with no incidents. See ADR-012 in `constitution.md`.

---

## [2.0.1](https://github.com/tintindavid/Backend-Timtto/compare/v2.0.0...v2.0.1) (2026-07-02)


### Bug Fixes

* **security:** allow '__platform__' sentinel through tenantResolver ([45d4fcc](https://github.com/tintindavid/Backend-Timtto/commit/45d4fccab6fd2dd68e0f9c1401c31afc887d70c3))

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
