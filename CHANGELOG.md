## [Unreleased] (2026-08-11)


### Bug Fixes

* **portal-cliente:** HTs firmadas desde el portal ahora reciben el numeroHoja `${OT.Consecutivo}-N` (ej. `OT000029-2`) — antes se generaba con el contador global `HNNNN` (ej. `H0004`), quedando inconsistentes con las HTs del flujo admin de la misma OT. Ambos flujos comparten ahora `sheetWorkService._resolveNumeroHoja`. Sin migración: HTs históricas conservan su nombre; el contador global `SHEET` se preserva como fallback para OTs sin `Consecutivo`.
* **ot:** `PUT /api/v1/ots/:id` was crashing in dev with `Transaction numbers are only allowed on a replica set member or mongos` (MongoServerError code 20) because `ot.service.js#update` wraps the OT-completion side effects (inventory decrement + repuestos status flip + trazabilidad record) in a MongoDB transaction. Prod runs Atlas (replica set) so the txn path succeeds, but local standalone `mongod` throws. Fixed via a new shared helper `utils/mongoSession.util.js#runWithTransactionFallback` — attempts the transactional path first, catches code 20 specifically, and re-runs the same block without a session. Preserves atomic semantics in prod, unblocks dev. Logs a one-shot `warn` when the fallback triggers.

### Features

* **sheetwork:** share a signed HT via a one-off download link — new admin endpoint `POST /api/v1/sheetwork/:sheetId/share` issues a `SheetWorkDownloadToken` (3 downloads / 3 days, optional `allowReports` for 2 reports-ZIP downloads), records `shareHistory` on the sheet, appends the recipient email to `Customer.correousados`, and dispatches a Resend email. Reissue overwrites the previous token — the old URL 404s.
* **sheetwork:** new public endpoints `GET /public/sheet-download/:token` (metadata), `GET /public/sheet-download/:token/pdf` (streams the HT PDF, atomic counter increment, 410 on exhaustion), `GET /public/sheet-download/:token/reports.zip` (only when `allowReports: true`, 410 on exhaustion). Same mount pattern as `/public/sheet-sign` — rate limiters before the token resolver.
* **email:** new Handlebars templates `sheet-share-download.hbs` + `.txt.hbs` and `emailService.sendSheetShareDownloadEmail`.

### Refactor

* **portal:** `clientPortalService.getSheetsForToken` / `getSheetPdfLocation` / `getSheetReportsZip` now filter by `otId ∈ token.otIds` + `firmaFile` non-empty, replacing the previous `clientSignature.tokenId === currentToken` gate. Portal reads open — the client sees the full signed history of the OTs in their token's scope, including HTs signed under a previous token or on-site. The write path `signExistingSheet` keeps the D12 gate unchanged.

# [2.11.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.10.0...v2.11.0) (2026-08-11)


### Features

* **pdf-reports): dynamic filename builder + fix(listings:** server-side search ([7972866](https://github.com/tintindavid/Backend-Timtto/commit/7972866d5f4454006dc4a24ebc61c018daa9e71d))

## [Unreleased] (2026-08-11)


### Bug Fixes

* **protocolomtto/items:** `list` services now search on the model's real field names — `nombre`/`Descripcion` for protocols and `Nombre`/`Observacion` for items. Previously the `$or` clause pointed to `name/description/title/email`, which do not exist on either model, so the `search` query param silently matched nothing on the backend even when the frontend sent it. Also escapes regex metacharacters via the new shared `escapeRegex.util.js`, closing a catastrophic-backtracking DoS vector (`search=.*` used to build `/.*/i` over the whole collection).
* **customer.service:** switched from an inline `escapeRegex` const to the shared `utils/escapeRegex.util.js` — behavior unchanged, single source of truth.

### Features

* **pdf-reports:** `POST /api/v1/pdf-reports/bulk` accepts an optional `fileNameConfig: { tokens: string[] }` body (tokens: `consecutivo | serial | inventario | item | fecha`, order-preserving, unique, non-empty). Each PDF inside the returned ZIP is named from the tokens in the requested order, sanitized (NFD accent fold, Windows-reserved chars stripped, whitespace/underscore runs collapsed, capped at 120 chars). Absent/empty config falls back to the current hardcoded `consecutivo item inventario` pattern — every existing caller (client-portal `getSheetReportsZip`, etc.) stays working with zero change.

# [2.10.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.9.0...v2.10.0) (2026-08-11)


### Features

* **portal:** sheetwork remote signature + client-token edit and send-link ([b28bc50](https://github.com/tintindavid/Backend-Timtto/commit/b28bc507550d5d1ffc1ae9b9456a8bf72771ea22))

## [Unreleased] (2026-08-10)


### Features

* **sheetwork:** remote signature flow — new admin endpoint `POST /api/v1/sheetwork/remote-sign-request` creates a HT in `EnviadaAFirmar`, issues a 7-day `SheetWorkSignToken`, and dispatches a Resend email with a `/firma/<token>` link. Recipient email is `$addToSet`-appended to `Customer.correousados` (soft cap 20). Requires the caller's `User.fileFirma` to be set — same prerequisite as the on-site flow; missing signature returns 409 `USER_HAS_NO_SIGNATURE` and no sheet is created. The requester's `fileFirma`, `fullName`, and `role` are baked into `SheetWork.firmaResponsableFile` / `fullNameResponsable` / `cargoResponsable` at creation so the client's PDF preview and the final signed PDF both render the responsible technician's signature block.
* **sheetwork:** new admin endpoint `POST /api/v1/sheetwork/:sheetId/resend-sign-request` reuses the active token or upserts a new one; increments `resendCount`; updates the sheet + customer email; re-dispatches the request email.
* **sheetwork:** new admin endpoint `POST /api/v1/sheetwork/:sheetId/sign-inplace` closes an `EnviadaAFirmar` HT on-site (reports → Cerrado, OT recompute, cascade, PDF regen) and marks the outstanding remote token as `superseded`.
* **sheetwork:** new public endpoints `GET|POST /public/sheet-sign/:token` — the client reads the sheet's PDF-preview HTML, submits a signature (canvas or upload), triggers the shared closure, renews the token to `signedAt + 7d`, and receives + notifies the requester via confirmation emails without PDF attachment.
* **sheetwork:** `SheetWork.estado` enum extended with `EnviadaAFirmar`; new subdoc `remoteSignRequest` on `SheetWork`; new `correousados` array on `Customer`; new collection `sheet_work_sign_tokens`.
* **client-tokens:** new admin endpoint `PATCH /api/v1/client-tokens/:id/ots` appends OTs to an active token via `$addToSet`. Every submitted OT must belong to the token's `clienteId`; revoked tokens return 409 `TOKEN_REVOKED`. `clienteId` and `attributionUserId` remain immutable.
* **client-tokens:** new admin endpoint `POST /api/v1/client-tokens/:id/send` dispatches the portal link by email via Resend and records `emailHistory: { lastEmail, lastSentAt, lastSentBy, sendCount }` on the token doc. Attempt is recorded even when Resend fails or `NOTIFICATIONS_ENABLED=false`; the `emailSent` flag reflects the transport outcome. Recipient email is `$addToSet`-appended to `Customer.correousados` (shared pool with the sheetwork-remote-signature flow).
* **email:** Handlebars templates + `emailService` methods: `sheet-sign-request`, `sheet-signed-client`, `sheet-signed-requester`, `client-portal-link` (each with `.txt.hbs` counterpart).

### Refactor

* **signatures:** sharp-based blank-PNG validator extracted from `clientPortalSign.dto.js` into `utils/validateSignaturePng.util.js`; consumed by the portal DTO and the new `publicSheetSign.dto.js` — behavior unchanged.
* **customers:** `_pushCorreoUsado` extracted from `sheetWorkService` into `utils/customerCorreosUsados.util.js` — `sheetWorkService` and the new `clientAccessTokenService.sendLink` share one implementation of `$addToSet` + soft-cap truncation.

### Rollout requirements

* **notifications:** both the remote signature flow and the client-tokens send-link flow require `NOTIFICATIONS_ENABLED=true` and a valid `SMTP_PASSWORD` (Resend API key) in production. Without both, the endpoints still create the sheets/tokens and record the attempt but return `emailSent: false`; the admin sees a yellow toast and can resend from the row.

# [2.9.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.8.0...v2.9.0) (2026-08-06)


### Features

* **portal:** close reports on client sign + late-sign + image upload ([8b0d3db](https://github.com/tintindavid/Backend-Timtto/commit/8b0d3db0b139fab4a18ea3c52c394173c9c3df0e))

# [2.8.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.7.0...v2.8.0) (2026-08-03)


### Features

* **portal-cliente:** sheet-reports ZIP + summary estadoOperativo/fechaProcesado ([c085950](https://github.com/tintindavid/Backend-Timtto/commit/c0859503f1647eb36203d0abd961c342ac714c34))

# [2.7.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.6.0...v2.7.0) (2026-08-03)


### Features

* **portal-cliente:** permission-based access + técnico attribution ([8a3bc25](https://github.com/tintindavid/Backend-Timtto/commit/8a3bc25024eb4032bea7b23974876a4aa7e44f6f))

# [2.6.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.5.0...v2.6.0) (2026-08-02)


### Features

* **client-portal:** public read-only + review + sign + note per report ([d10751e](https://github.com/tintindavid/Backend-Timtto/commit/d10751e3a1c8641c968987f0291cceb5bbdbeda4))

# [2.5.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.4.2...v2.5.0) (2026-07-14)


### Features

* rbac granular, historial, notas ot, guía rápida, verificación de parámetros y personal ([6d7d188](https://github.com/tintindavid/Backend-Timtto/commit/6d7d188e5f2c8deca00f8db75a46ebfd29009ad5))

## [2.4.2](https://github.com/tintindavid/Backend-Timtto/compare/v2.4.1...v2.4.2) (2026-07-05)


### Bug Fixes

* **email:** switch from SMTP to Resend HTTP API to bypass port 465 blocking ([9a8960d](https://github.com/tintindavid/Backend-Timtto/commit/9a8960db43894e6bed1ed3b098b049d7d3d55f7a))

## [2.4.1](https://github.com/tintindavid/Backend-Timtto/compare/v2.4.0...v2.4.1) (2026-07-05)


### Bug Fixes

* **email:** add startup diagnostic log for email service configuration ([3f6f2d6](https://github.com/tintindavid/Backend-Timtto/commit/3f6f2d64e51ad30c095eba8262580f3eb4b77d73))
* **env:** warn loudly when PUBLIC_APP_URL is missing or localhost in production ([fcde14b](https://github.com/tintindavid/Backend-Timtto/commit/fcde14b5a02c703268b3dcc7de5e2f3ec5797d92))

# [2.4.0](https://github.com/tintindavid/Backend-Timtto/compare/v2.3.0...v2.4.0) (2026-07-05)


### Features

* **auth:** add createPasswordResetToken and resetPassword to UserService ([93b6a04](https://github.com/tintindavid/Backend-Timtto/commit/93b6a04438065fa1df443683566a407a2a43f501))
* **auth:** add forgot-password email template and sendForgotPasswordEmail ([6130ff2](https://github.com/tintindavid/Backend-Timtto/commit/6130ff287370a6abb4b4d2c81f385a929567763a))
* **auth:** add forgotPassword and resetPassword controller handlers and routes ([0e284fc](https://github.com/tintindavid/Backend-Timtto/commit/0e284fc44490291cd07b7f29b67fe4bbfdfddd1e))
* **auth:** add forgotPassword and resetPassword DTOs ([92252de](https://github.com/tintindavid/Backend-Timtto/commit/92252dec226a510dab36e129accbcefd442a8094))
* **auth:** add passwordResetToken and passwordResetExpires to User schema ([2ed51f4](https://github.com/tintindavid/Backend-Timtto/commit/2ed51f49937ea809471f314de20cf2372d64e80e))
* **auth:** add validate-reset-token endpoint and password strength rules ([0708fec](https://github.com/tintindavid/Backend-Timtto/commit/0708fecbe933196d0d2b33f6fb1b564fd3660c24))

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
