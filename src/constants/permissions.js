'use strict';

/**
 * TIMTTO Permission Catalog — single source of truth for RBAC.
 *
 * Convention:
 *   - Resource names are **plural** and **kebab-case** (users, ots, hv-equipos).
 *   - Action verbs are lowercase, separated by ':' (read, create, update, delete).
 *   - Special verbs (pdf, close, assign-role, generate) are reserved for
 *     resource-specific actions that don't map to CRUD.
 *
 * Rules:
 *   - Adding a new permission here is only meaningful when a route also enforces
 *     it via `authorize('resource:action')`. Never persist a permission string
 *     that doesn't appear in this file — Role.service validates against
 *     PERMISSION_VALUES on create/update.
 *   - Platform routes (/api/v1/platform/*) are NOT governed by this catalog.
 *     They are gated by the legacy `role: 'superadmin'` check.
 *   - Public routes (/public/*) and /auth/* require no permission.
 */
export const PERMISSIONS = {
  // Users
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  USERS_ASSIGN_ROLE: 'users:assign-role',

  // Roles
  ROLES_READ: 'roles:read',
  ROLES_CREATE: 'roles:create',
  ROLES_UPDATE: 'roles:update',
  ROLES_DELETE: 'roles:delete',

  // My tenant (self-service tenant metadata)
  MY_TENANT_READ: 'my-tenant:read',
  MY_TENANT_UPDATE: 'my-tenant:update',

  // Customers
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_DELETE: 'customers:delete',
  CUSTOMERS_DOWNLOAD_INVENTARIO: 'customers:download-inventario',

  // Sedes
  SEDES_READ: 'sedes:read',
  SEDES_CREATE: 'sedes:create',
  SEDES_UPDATE: 'sedes:update',
  SEDES_DELETE: 'sedes:delete',

  // Addresses
  ADDRESSES_READ: 'addresses:read',
  ADDRESSES_CREATE: 'addresses:create',
  ADDRESSES_UPDATE: 'addresses:update',
  ADDRESSES_DELETE: 'addresses:delete',

  // Servicios
  SERVICIOS_READ: 'servicios:read',
  SERVICIOS_CREATE: 'servicios:create',
  SERVICIOS_UPDATE: 'servicios:update',
  SERVICIOS_DELETE: 'servicios:delete',

  // Equipo items
  EQUIPO_ITEMS_READ: 'equipo-items:read',
  EQUIPO_ITEMS_CREATE: 'equipo-items:create',
  EQUIPO_ITEMS_UPDATE: 'equipo-items:update',
  EQUIPO_ITEMS_DELETE: 'equipo-items:delete',

  // Estado equipo
  ESTADO_EQUIPO_READ: 'estado-equipo:read',
  ESTADO_EQUIPO_CREATE: 'estado-equipo:create',
  ESTADO_EQUIPO_UPDATE: 'estado-equipo:update',
  ESTADO_EQUIPO_DELETE: 'estado-equipo:delete',

  // Historia clínica de equipos
  HV_EQUIPOS_READ: 'hv-equipos:read',
  HV_EQUIPOS_CREATE: 'hv-equipos:create',
  HV_EQUIPOS_UPDATE: 'hv-equipos:update',
  HV_EQUIPOS_DELETE: 'hv-equipos:delete',
  HV_EQUIPOS_PDF: 'hv-equipos:pdf',

  // Items catálogo
  ITEMS_READ: 'items:read',
  ITEMS_CREATE: 'items:create',
  ITEMS_UPDATE: 'items:update',
  ITEMS_DELETE: 'items:delete',

  // Órdenes de Trabajo (OT)
  OTS_READ: 'ots:read',
  OTS_CREATE: 'ots:create',
  OTS_UPDATE: 'ots:update',
  OTS_DELETE: 'ots:delete',
  OTS_CLOSE: 'ots:close',
  OTS_REOPEN: 'ots:reopen',
  // Programación trazable (ot-responsables-programacion-trazable):
  // OTS_MANAGE_RESPONSABLES gates POST /ots/:id/programacion (who may
  // (re)assign responsables). OTS_CAN_BE_RESPONSIBLE is an eligibility
  // marker, not an action permission — only users whose role carries it may
  // be *added* to a roster (enforced server-side in ot.service.js#setProgramacion).
  OTS_MANAGE_RESPONSABLES: 'ots:manage-responsables',
  OTS_CAN_BE_RESPONSIBLE: 'ots:can-be-responsible',

  // Reportes (informes de servicio)
  REPORTS_READ: 'reports:read',
  REPORTS_CREATE: 'reports:create',
  REPORTS_UPDATE: 'reports:update',
  REPORTS_DELETE: 'reports:delete',
  REPORTS_PDF: 'reports:pdf',

  // Informes (agregados / bulk)
  INFORMES_READ: 'informes:read',
  INFORMES_CREATE: 'informes:create',
  INFORMES_UPDATE: 'informes:update',
  INFORMES_DELETE: 'informes:delete',
  INFORMES_GENERATE: 'informes:generate',

  // PDF reports (batch)
  PDF_REPORTS_GENERATE: 'pdf-reports:generate',

  // Portal cliente — permite crear accesos (tokens) para que un cliente
  // revise sus OTs desde /portal/:token. Antes gateado por role=admin,
  // ahora por este permiso para que biomedicos u otros roles designados
  // por el admin del tenant puedan emitirlos. Constant name in Spanish
  // per user request (2026-08-03); value follows the resource:action
  // convention aligned with the /api/v1/client-tokens route.
  PORTAL_CLIENTE_CREAR: 'client-access-tokens:create',

  // Cronogramas
  CRONOGRAMAS_READ: 'cronogramas:read',
  CRONOGRAMAS_CREATE: 'cronogramas:create',
  CRONOGRAMAS_UPDATE: 'cronogramas:update',
  CRONOGRAMAS_DELETE: 'cronogramas:delete',
  CRONOGRAMAS_PDF: 'cronogramas:pdf',

  // Actividades de mantenimiento (catálogo)
  ACTIVIDAD_MTTO_READ: 'actividad-mtto:read',
  ACTIVIDAD_MTTO_CREATE: 'actividad-mtto:create',
  ACTIVIDAD_MTTO_UPDATE: 'actividad-mtto:update',
  ACTIVIDAD_MTTO_DELETE: 'actividad-mtto:delete',

  // Actividades registradas en reportes
  ACTIVIDAD_REPORTE_READ: 'actividad-reporte:read',
  ACTIVIDAD_REPORTE_CREATE: 'actividad-reporte:create',
  ACTIVIDAD_REPORTE_UPDATE: 'actividad-reporte:update',
  ACTIVIDAD_REPORTE_DELETE: 'actividad-reporte:delete',

  // Protocolos de mantenimiento
  PROTOCOLO_MTTO_READ: 'protocolo-mtto:read',
  PROTOCOLO_MTTO_CREATE: 'protocolo-mtto:create',
  PROTOCOLO_MTTO_UPDATE: 'protocolo-mtto:update',
  PROTOCOLO_MTTO_DELETE: 'protocolo-mtto:delete',

  // Protocolos de actividad
  PROTOCOLO_ACTIVIDAD_READ: 'protocolo-actividad:read',
  PROTOCOLO_ACTIVIDAD_CREATE: 'protocolo-actividad:create',
  PROTOCOLO_ACTIVIDAD_UPDATE: 'protocolo-actividad:update',
  PROTOCOLO_ACTIVIDAD_DELETE: 'protocolo-actividad:delete',

  // Repuestos (catálogo)
  REPUESTOS_READ: 'repuestos:read',
  REPUESTOS_CREATE: 'repuestos:create',
  REPUESTOS_UPDATE: 'repuestos:update',
  REPUESTOS_DELETE: 'repuestos:delete',

  // Inventario de repuestos
  INVENTARIO_READ: 'inventario:read',
  INVENTARIO_CREATE: 'inventario:create',
  INVENTARIO_UPDATE: 'inventario:update',
  INVENTARIO_DELETE: 'inventario:delete',

  // Trazabilidad de repuestos
  REPUESTO_TRAZABILIDAD_READ: 'repuesto-trazabilidad:read',
  REPUESTO_TRAZABILIDAD_CREATE: 'repuesto-trazabilidad:create',
  REPUESTO_TRAZABILIDAD_UPDATE: 'repuesto-trazabilidad:update',
  REPUESTO_TRAZABILIDAD_DELETE: 'repuesto-trazabilidad:delete',

  // Sheetwork (worksheets)
  SHEETWORK_READ: 'sheetwork:read',
  SHEETWORK_CREATE: 'sheetwork:create',
  SHEETWORK_UPDATE: 'sheetwork:update',
  SHEETWORK_DELETE: 'sheetwork:delete',

  // Tickets por área — panel endpoints
  TICKETS_READ: 'tickets:read',
  TICKETS_CREATE: 'tickets:create',
  TICKETS_UPDATE: 'tickets:update',
  TICKETS_DELETE: 'tickets:delete',
  TICKETS_CLOSE: 'tickets:close',
  TICKETS_REPLY: 'tickets:reply',

  // Service QRs — panel endpoints
  SERVICE_QRS_READ: 'service-qrs:read',
  SERVICE_QRS_CREATE: 'service-qrs:create',
  SERVICE_QRS_UPDATE: 'service-qrs:update',
  SERVICE_QRS_DELETE: 'service-qrs:delete',
};

export const PERMISSION_VALUES = Object.values(PERMISSIONS);

/**
 * Grouped view for UI rendering. GET /api/v1/permissions returns
 * PERMISSIONS_BY_RESOURCE so the frontend groups checkboxes without
 * re-parsing the strings.
 */
export const PERMISSIONS_BY_RESOURCE = PERMISSION_VALUES.reduce((acc, permission) => {
  const [resource] = permission.split(':');
  acc[resource] = acc[resource] || [];
  acc[resource].push(permission);
  return acc;
}, {});
