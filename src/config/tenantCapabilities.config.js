import { logger } from './logger.config.js';
import { ApiError } from '../utils/apiError.util.js';

/**
 * Tenant capabilities (change: tenant-capabilities-hybrid-mode).
 *
 * A capability is a per-tenant CEILING on a feature set, independent of the per-role RBAC
 * permissions: a user needs both the permission and the tenant capability.
 *
 *   executesServices  work orders, reports and worksheets (default true)
 *   registersExternal records services performed by third parties (default false)
 *
 * The tenant "type" is derived, never stored:
 *   provider = executesServices only, client = registersExternal only, hybrid = both.
 * At least one flag must be true.
 */

export const DEFAULT_CAPABILITIES = Object.freeze({ executesServices: true, registersExternal: false });
export const ALL_CAPABILITIES_ENABLED = Object.freeze({ executesServices: true, registersExternal: true });
export const TENANT_TYPES = Object.freeze(['provider', 'client', 'hybrid']);
export const CAPABILITY_NAMES = Object.freeze(['executesServices', 'registersExternal']);

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PRESETS = Object.freeze({
  provider: { executesServices: true, registersExternal: false },
  client: { executesServices: false, registersExternal: true },
  hybrid: { executesServices: true, registersExternal: true },
});

/**
 * Route map: mounts of the execution flow whose MUTATING requests need a capability.
 * Data only, so the next change can add `registersExternal` entries without touching the middleware.
 * (`/api/v1/customers` is NOT here: it needs the document kind, see customerService.)
 */
export const CAPABILITY_ROUTE_MAP = Object.freeze([
  { prefix: '/api/v1/ots', capability: 'executesServices' },
  { prefix: '/api/v1/reports', capability: 'executesServices' },
  { prefix: '/api/v1/reportes', capability: 'executesServices' },
  { prefix: '/api/v1/actividad-reporte', capability: 'executesServices' },
  { prefix: '/api/v1/sheetwork', capability: 'executesServices' },
  { prefix: '/api/v1/worksheets', capability: 'executesServices' },
  { prefix: '/api/v1/client-tokens', capability: 'executesServices' },
  // Endpoints of "common" mounts that still create work orders and reports (found by the security audit).
  { prefix: '/api/v1/tickets/work-order', capability: 'executesServices' },
  { prefix: '/api/v1/repuestos/ot-from-solicitudes', capability: 'executesServices' },
]);

/**
 * Mounts under /api/v1 that are deliberately NOT gated by a capability. A router mounted in app.js
 * must appear either in CAPABILITY_ROUTE_MAP or here (enforced by
 * tests/config/tenantCapabilities.config.test.js), so a new router forces an explicit decision.
 *
 * Classification notes:
 *  - customers: handled by customerService by `kind` (providers are always allowed).
 *  - tickets / service-qrs / equipment-qrs: left open on purpose (design: "not gated"), except
 *    `POST /tickets/work-order` and `POST /repuestos/ot-from-solicitudes`, which create OTs and reports
 *    and are listed in CAPABILITY_ROUTE_MAP.
 *  - cronogramas, actividad-mtto, equipos/:equipoId (external activities), equipo-items, hv-equipo:
 *    the client keeps its own equipment records, schedules and activities.
 *  - informes / pdf-reports: generated documents, reads of history.
 *  - platform/*: SuperAdmin only (already excluded from tenant guards).
 */
export const COMMON_ROUTE_PREFIXES = Object.freeze([
  // identity, access and tenant data
  '/api/v1/auth',
  '/api/v1/users',
  '/api/v1/roles',
  '/api/v1/permissions',
  '/api/v1/history',
  '/api/v1/my-tenant',
  '/api/v1/tenants',
  // third parties and locations
  '/api/v1/customers',
  '/api/v1/customer-no-usar',
  '/api/v1/address',
  '/api/v1/sedes',
  '/api/v1/servicios',
  // equipment, schedules and activities
  '/api/v1/cronogramas',
  '/api/v1/actividad-mtto',
  '/api/v1/equipo-items',
  '/api/v1/estado-equipo',
  '/api/v1/hv-equipo',
  '/api/v1/equipos',
  '/api/v1/items',
  '/api/v1/protocolo-actividad',
  '/api/v1/protocolo-mtto',
  // spare parts
  '/api/v1/repuestos',
  '/api/v1/inventario-repuestos',
  '/api/v1/repuesto-trazabilidad',
  // documents
  '/api/v1/informes',
  '/api/v1/pdf-reports',
  // tickets and QR modules
  '/api/v1/tickets',
  '/api/v1/service-qrs',
  '/api/v1/equipment-qrs',
  // notifications
  '/api/v1/notifications',
  '/api/v1/notification-rules',
  '/api/v1/notification-preferences',
  // platform console (SuperAdmin only)
  '/api/v1/platform/tenants',
  '/api/v1/platform/users',
  '/api/v1/platform/audit-log',
  '/api/v1/platform/view-as',
  '/api/v1/platform/analytics',
]);

/**
 * Applies the defaults to a stored capabilities value. Lean queries do not apply schema defaults,
 * and tenants created before this change have no field at all, so every reader must normalize.
 *
 * @param {object|null|undefined} value
 * @returns {{ executesServices: boolean, registersExternal: boolean }}
 */
export function normalizeCapabilities(value) {
  const src = value && typeof value === 'object' ? value : {};
  return {
    executesServices: src.executesServices === undefined || src.executesServices === null
      ? DEFAULT_CAPABILITIES.executesServices
      : Boolean(src.executesServices),
    registersExternal: src.registersExternal === undefined || src.registersExternal === null
      ? DEFAULT_CAPABILITIES.registersExternal
      : Boolean(src.registersExternal),
  };
}

/** Throws 400 when no flag is enabled. */
export function assertValidCapabilities(capabilities) {
  const caps = normalizeCapabilities(capabilities);
  if (!caps.executesServices && !caps.registersExternal) {
    throw new ApiError(
      400,
      'Al menos una capacidad debe estar habilitada (ejecuta servicios o registra servicios de terceros)',
      'INVALID_CAPABILITIES',
    );
  }
  return caps;
}

/**
 * Derived tenant type. Throws 400 when both flags are off.
 * @returns {'provider'|'client'|'hybrid'}
 */
export function getTenantType(capabilities) {
  const caps = assertValidCapabilities(capabilities);
  if (caps.executesServices && caps.registersExternal) return 'hybrid';
  return caps.executesServices ? 'provider' : 'client';
}

/** Flags of a preset (`provider`, `client`, `hybrid`). Throws 400 for any other value. */
export function presetToCapabilities(type) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, type)) {
    throw new ApiError(400, "El tipo de organización debe ser 'provider', 'client' o 'hybrid'", 'INVALID_TENANT_TYPE', { type });
  }
  return { ...PRESETS[type] };
}

/**
 * Resolves the capabilities requested by a body ({ type } preset, { capabilities } or loose flags).
 * Flags are merged over `base` (the current values; defaults when omitted). The result is validated.
 */
export function resolveCapabilitiesInput(input = {}, base = DEFAULT_CAPABILITIES) {
  let caps;
  if (input.type !== undefined && input.type !== null) {
    caps = presetToCapabilities(input.type);
  } else {
    const flags = input.capabilities && typeof input.capabilities === 'object' ? input.capabilities : input;
    const current = normalizeCapabilities(base);
    caps = {
      executesServices: flags.executesServices === undefined ? current.executesServices : Boolean(flags.executesServices),
      registersExternal: flags.registersExternal === undefined ? current.registersExternal : Boolean(flags.registersExternal),
    };
  }
  return assertValidCapabilities(caps);
}

/**
 * Capability required by a request path, or null when the path is not gated.
 * Matches on a segment boundary and ignores case (Express routing is case-insensitive, so
 * `/API/V1/OTS` reaches the same router and must be gated too) and collapses repeated slashes
 * (Express also routes `/api/v1/tickets//work-order` to the same handler).
 *
 * @param {string} pathname  path without query string
 * @returns {string|null}
 */
export function findRequiredCapability(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return null;
  const path = pathname.toLowerCase().replace(/\/{2,}/g, '/');
  for (const { prefix, capability } of CAPABILITY_ROUTE_MAP) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return capability;
  }
  return null;
}

/** Shape returned by the exposure endpoints. */
export function describeCapabilities(capabilities, organizationCustomerId = null) {
  const caps = normalizeCapabilities(capabilities);
  return {
    executesServices: caps.executesServices,
    registersExternal: caps.registersExternal,
    type: getTenantType(caps),
    organizationCustomerId: organizationCustomerId ? String(organizationCustomerId) : null,
  };
}

/**
 * Rollout mode of ENFORCE_TENANT_CAPABILITIES, read at call time: `on` (default and the value of any
 * unknown setting), `warn` (log the denial and allow) or `off` (bypass). Case and surrounding spaces
 * are ignored. Shared by the global guard and by the customers rules so both obey the same switch.
 */
export function getEnforcementMode() {
  const value = String(process.env.ENFORCE_TENANT_CAPABILITIES ?? '').trim().toLowerCase();
  return value === 'off' || value === 'warn' ? value : 'on';
}

/** Throws 403 CAPABILITY_DISABLED when `capability` is off in `capabilities` (honours the rollout mode). */
export function assertCapability(capabilities, capability, message) {
  const caps = normalizeCapabilities(capabilities);
  if (!caps[capability]) {
    const mode = getEnforcementMode();
    if (mode === 'off') return;
    if (mode === 'warn') {
      logger.warn('assertCapability: would deny (warn mode, request allowed)', { capability });
      return;
    }
    throw new ApiError(
      403,
      message || 'Tu organización no tiene habilitada esta función',
      'CAPABILITY_DISABLED',
      { capability },
    );
  }
}
