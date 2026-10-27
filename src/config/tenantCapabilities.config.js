import { logger } from './logger.config.js';
import { ApiError } from '../utils/apiError.util.js';

/**
 * Tenant capabilities (change: tenant-capabilities-hybrid-mode).
 *
 * A capability is a per-tenant CEILING on a feature set, independent of the per-role RBAC
 * permissions: a user needs both the permission and the tenant capability.
 *
 *   executesServices  work orders, reports and worksheets (default true)
 *   registersExternal records services performed by third parties (default false); it is also the premium
 *                     module "Servicios de terceros" (change: modulos-premium-por-tenant)
 *   usesQrs           premium module "QRs y tickets": equipment QRs, service QRs and tickets (default false);
 *                     independent of the other two, it takes no part in the derived type
 *   scheduleQuickLoad premium switch "Carga rápida desde el cronograma" (change: cronograma-carga-rapida): the
 *                     interface offers loading from the schedule cells. It REQUIRES registersExternal; it does not
 *                     protect any endpoint (the forms use the existing, already protected ones) and takes no part
 *                     in the derived type
 *   usesInventoryBasic    premium module "Stock" basic level (change: inventario-stock): spare parts / accessories
 *                         catalogue. Independent of the derived type
 *   usesInventoryAdvanced premium module "Stock" advanced level: quantities, movements (kardex) and the stock
 *                         discount on work-order completion. It REQUIRES usesInventoryBasic
 *   usesRequisiciones     premium module "Requisiciones" (change: requisiciones-e1-base-aprobacion): purchase requisitions,
 *                         areas, approval rules and area budgets. Independent of every other flag (default false)
 *   managesCustomers      premium capability "Gestiona clientes" (change: requisiciones-e1-base-aprobacion): the tenant
 *                         creates/edits/deletes customers (kind=customer). It REQUIRES executesServices. With
 *                         executesServices=true and managesCustomers=false the tenant is in "mantenimiento propio": full
 *                         package, but every OT/report/worksheet uses its organization customer. New tenants start OFF;
 *                         a stored capabilities object WITHOUT the flag (legacy) reads as executesServices (see normalize).
 *
 * The tenant "type" is derived, never stored:
 *   provider = executesServices only, client = registersExternal only, hybrid = both.
 * At least one flag must be true.
 */

export const DEFAULT_CAPABILITIES = Object.freeze({ executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false, usesRequisiciones: false, managesCustomers: false });
export const ALL_CAPABILITIES_ENABLED = Object.freeze({ executesServices: true, registersExternal: true, usesQrs: true, scheduleQuickLoad: true, usesInventoryBasic: true, usesInventoryAdvanced: true, usesRequisiciones: true, managesCustomers: true });
export const TENANT_TYPES = Object.freeze(['provider', 'client', 'hybrid']);
export const CAPABILITY_NAMES = Object.freeze(['executesServices', 'registersExternal', 'usesQrs', 'scheduleQuickLoad', 'usesInventoryBasic', 'usesInventoryAdvanced', 'usesRequisiciones', 'managesCustomers']);

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PRESETS = Object.freeze({
  provider: { executesServices: true, registersExternal: false },
  client: { executesServices: false, registersExternal: true },
  hybrid: { executesServices: true, registersExternal: true },
});

/**
 * Route map: paths that need a capability. Data only, so a new entry needs no middleware change.
 *
 * An entry is `{ prefix | pattern, capability, blockReads? }`:
 *  - `prefix` matches the path and its sub-paths on a segment boundary; `pattern` is a RegExp tested on the
 *    lower-cased, slash-collapsed path (for paths with an identifier segment);
 *  - by default only MUTATING requests are gated (reads stay available so history remains readable);
 *    `blockReads: true` also gates reads (GET, HEAD...) so a premium module hides its data completely;
 *  - a request that matches several entries needs ALL their capabilities.
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
  // Premium module "Servicios de terceros" (registersExternal): external activities and external services,
  // reads included (modulos-premium-por-tenant).
  { prefix: '/api/v1/cronogramas/actividades-externas', capability: 'registersExternal', blockReads: true },
  { pattern: /^\/api\/v1\/equipos\/[^/]+\/(actividades-externas|cadenas-actividad|reportes-externos)(\/|$)/, capability: 'registersExternal', blockReads: true },
  // Premium module "QRs y tickets" (usesQrs): equipment QRs, service QRs and tickets, reads included.
  // POST /tickets/work-order also matches its executesServices entry above and needs both.
  { prefix: '/api/v1/tickets', capability: 'usesQrs', blockReads: true },
  { prefix: '/api/v1/service-qrs', capability: 'usesQrs', blockReads: true },
  { prefix: '/api/v1/equipment-qrs', capability: 'usesQrs', blockReads: true },
  // Premium module "Stock" (inventario-stock): catalogue (basic) and movements (advanced), reads included.
  { prefix: '/api/v1/inventario-repuestos', capability: 'usesInventoryBasic', blockReads: true },
  { prefix: '/api/v1/inventario-movimientos', capability: 'usesInventoryAdvanced', blockReads: true },
  // Premium module "Requisiciones" (requisiciones-e1-base-aprobacion): requisitions, areas, approval rules,
  // area budgets and requisition types, reads included.
  { prefix: '/api/v1/requisiciones', capability: 'usesRequisiciones', blockReads: true },
  { prefix: '/api/v1/areas', capability: 'usesRequisiciones', blockReads: true },
  { prefix: '/api/v1/reglas-aprobacion', capability: 'usesRequisiciones', blockReads: true },
  { prefix: '/api/v1/presupuestos-area', capability: 'usesRequisiciones', blockReads: true },
  { prefix: '/api/v1/tipos-requisicion', capability: 'usesRequisiciones', blockReads: true },
]);

/**
 * Mounts under /api/v1 that are deliberately NOT gated by a capability. A router mounted in app.js
 * must appear either in CAPABILITY_ROUTE_MAP or here (enforced by
 * tests/config/tenantCapabilities.config.test.js), so a new router forces an explicit decision.
 *
 * Classification notes:
 *  - customers: handled by customerService by `kind` (providers are always allowed).
 *  - tickets / service-qrs / equipment-qrs: the premium module "QRs y tickets" (usesQrs), in the map with
 *    `blockReads`; `POST /tickets/work-order` and `POST /repuestos/ot-from-solicitudes` also need executesServices.
 *  - cronogramas, actividad-mtto, equipos/:equipoId, equipo-items, hv-equipo: the client keeps its own equipment
 *    records, schedules and activities. The external parts (`/cronogramas/actividades-externas` and
 *    `/equipos/:id/actividades-externas|cadenas-actividad|reportes-externos`) are the premium module
 *    "Servicios de terceros" (registersExternal) and are in the map.
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
  '/api/v1/repuesto-trazabilidad',
  // documents
  '/api/v1/informes',
  '/api/v1/pdf-reports',
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
 * `scheduleQuickLoad` is the EFFECTIVE value: true only when it is stored true AND registersExternal is true, so a
 * document with an inconsistent pair reads as off and no read path ever fails.
 * `usesInventoryAdvanced` is effective the same way (needs usesInventoryBasic).
 * `managesCustomers` is effective the same way (needs executesServices). LEGACY READ: when the stored object has no
 * `managesCustomers` key (or the tenant has no capabilities at all) it reads as executesServices, so tenants created
 * before the flag existed keep managing customers. An explicit false/true is always honoured.
 * @returns {{ executesServices: boolean, registersExternal: boolean, usesQrs: boolean, scheduleQuickLoad: boolean, usesInventoryBasic: boolean, usesInventoryAdvanced: boolean, usesRequisiciones: boolean, managesCustomers: boolean }}
 */
export function normalizeCapabilities(value) {
  const src = value && typeof value === 'object' ? value : {};
  const registersExternal = src.registersExternal === undefined || src.registersExternal === null
    ? DEFAULT_CAPABILITIES.registersExternal
    : Boolean(src.registersExternal);
  const usesInventoryBasic = Boolean(src.usesInventoryBasic);
  const executesServices = src.executesServices === undefined || src.executesServices === null
    ? DEFAULT_CAPABILITIES.executesServices
    : Boolean(src.executesServices);
  const managesStored = src.managesCustomers === undefined || src.managesCustomers === null
    ? executesServices
    : Boolean(src.managesCustomers);
  return {
    executesServices,
    registersExternal,
    usesQrs: src.usesQrs === undefined || src.usesQrs === null
      ? DEFAULT_CAPABILITIES.usesQrs
      : Boolean(src.usesQrs),
    scheduleQuickLoad: registersExternal && Boolean(src.scheduleQuickLoad),
    usesInventoryBasic,
    usesInventoryAdvanced: usesInventoryBasic && Boolean(src.usesInventoryAdvanced),
    usesRequisiciones: Boolean(src.usesRequisiciones),
    managesCustomers: executesServices && managesStored,
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

/** Flags of a preset (`provider`, `client`, `hybrid`). Throws 400 for any other value. Presets never turn a premium module on. */
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
  const current = normalizeCapabilities(base);
  const flagsSource = input.capabilities && typeof input.capabilities === 'object' ? input.capabilities : input;
  // `usesQrs` is independent of the preset: it is kept from the current value unless the body sets it.
  const usesQrs = flagsSource.usesQrs === undefined ? current.usesQrs : Boolean(flagsSource.usesQrs);
  const scheduleQuickLoad = flagsSource.scheduleQuickLoad === undefined ? current.scheduleQuickLoad : Boolean(flagsSource.scheduleQuickLoad);
  const usesInventoryBasic = flagsSource.usesInventoryBasic === undefined ? current.usesInventoryBasic : Boolean(flagsSource.usesInventoryBasic);
  const usesInventoryAdvanced = flagsSource.usesInventoryAdvanced === undefined ? current.usesInventoryAdvanced : Boolean(flagsSource.usesInventoryAdvanced);
  const usesRequisiciones = flagsSource.usesRequisiciones === undefined ? current.usesRequisiciones : Boolean(flagsSource.usesRequisiciones);
  // Like usesQrs, managesCustomers is independent of the preset: kept from the current value unless the body sets it.
  const managesCustomers = flagsSource.managesCustomers === undefined ? current.managesCustomers : Boolean(flagsSource.managesCustomers);
  if (input.type !== undefined && input.type !== null) {
    caps = { ...presetToCapabilities(input.type), usesQrs, scheduleQuickLoad, usesInventoryBasic, usesInventoryAdvanced, usesRequisiciones, managesCustomers };
  } else {
    caps = {
      executesServices: flagsSource.executesServices === undefined ? current.executesServices : Boolean(flagsSource.executesServices),
      registersExternal: flagsSource.registersExternal === undefined ? current.registersExternal : Boolean(flagsSource.registersExternal),
      usesQrs,
      scheduleQuickLoad,
      usesInventoryBasic,
      usesInventoryAdvanced,
      usesRequisiciones,
      managesCustomers,
    };
  }
  // The requested result must be coherent (checked on the raw request: normalize would silently turn it off).
  if (caps.scheduleQuickLoad && !caps.registersExternal) {
    throw new ApiError(
      400,
      'La carga rápida desde el cronograma requiere el módulo Servicios de terceros: actívalo primero o apaga la carga rápida',
      'INVALID_CAPABILITIES',
      { capability: 'scheduleQuickLoad', requires: 'registersExternal' },
    );
  }
  if (caps.usesInventoryAdvanced && !caps.usesInventoryBasic) {
    throw new ApiError(
      400,
      'La gestión avanzada de stock requiere el inventario básico: actívalo primero o apaga la gestión avanzada',
      'INVALID_CAPABILITIES',
      { capability: 'usesInventoryAdvanced', requires: 'usesInventoryBasic' },
    );
  }
  // Switching a tenant to one that does not execute services drops the inherited flag instead of failing;
  // asking for managesCustomers explicitly without executesServices is the error.
  if (!caps.executesServices && flagsSource.managesCustomers === undefined) caps.managesCustomers = false;
  if (caps.managesCustomers && !caps.executesServices) {
    throw new ApiError(
      400,
      'Gestionar clientes requiere ejecutar servicios: actívalo primero o apaga la gestión de clientes',
      'INVALID_CAPABILITIES',
      { capability: 'managesCustomers', requires: 'executesServices' },
    );
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
  return findRequiredCapabilities(pathname)[0]?.capability ?? null;
}

/**
 * Every map entry that matches a request path, as `{ capability, blockReads }` (a path can need several
 * capabilities, e.g. `POST /tickets/work-order` needs executesServices and usesQrs). Same normalization as
 * findRequiredCapability.
 *
 * @param {string} pathname  path without query string
 * @returns {{ capability: string, blockReads: boolean }[]}
 */
export function findRequiredCapabilities(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return [];
  const path = pathname.toLowerCase().replace(/\/{2,}/g, '/');
  const found = [];
  for (const { prefix, pattern, capability, blockReads } of CAPABILITY_ROUTE_MAP) {
    const hit = pattern ? pattern.test(path) : path === prefix || path.startsWith(`${prefix}/`);
    if (hit) found.push({ capability, blockReads: Boolean(blockReads) });
  }
  return found;
}

/** Shape returned by the exposure endpoints. */
export function describeCapabilities(capabilities, organizationCustomerId = null) {
  const caps = normalizeCapabilities(capabilities);
  return {
    executesServices: caps.executesServices,
    registersExternal: caps.registersExternal,
    usesQrs: caps.usesQrs,
    scheduleQuickLoad: caps.scheduleQuickLoad,
    usesInventoryBasic: caps.usesInventoryBasic,
    usesInventoryAdvanced: caps.usesInventoryAdvanced,
    usesRequisiciones: caps.usesRequisiciones,
    managesCustomers: caps.managesCustomers,
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
