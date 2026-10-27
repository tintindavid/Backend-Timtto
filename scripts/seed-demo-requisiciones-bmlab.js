/**
 * seed-demo-requisiciones-bmlab.js
 *
 * DEMO DATA, not part of the product. Seeds the Requisiciones module of one tenant (default `bmlab`,
 * "Laboratorio Clinico BM") THROUGH THE REAL SERVICES (roles, users, areas, types, approval rules, budgets,
 * requisitions and their transitions), so timelines, versions, approvals, counters and budgets are coherent.
 *
 * Usage (see docs/requisiciones.md, "Datos de demostracion (bmlab)"):
 *   node scripts/seed-demo-requisiciones-bmlab.js --dry-run
 *   node scripts/seed-demo-requisiciones-bmlab.js --confirm
 *   node scripts/seed-demo-requisiciones-bmlab.js --reset --dry-run
 *   node scripts/seed-demo-requisiciones-bmlab.js --reset --confirm
 *
 * Flags: --dry-run (writes nothing) | --confirm (required for any real write) | --tenant=<id> (default bmlab) |
 *        --reset (delete ONLY the demo records listed below) | --force-remote (NOT used by us; see assertSafeEnvironment).
 * Env:   DEMO_PASSWORD (password of the demo users; otherwise a random one is generated and printed ONCE).
 *
 * SAFETY: refuses NODE_ENV=production and any MONGO_URI that is not localhost / 127.0.0.1 (unless --force-remote).
 * Outgoing email is forced OFF (NOTIFICATIONS_ENABLED=false) before any app module is loaded; in-app
 * notifications still fire. Every query is scoped by tenantId.
 *
 * What identifies the demo records (what --reset deletes, and what makes the run idempotent):
 *   users         email jefe.lab@bmlab.example.com, director@bmlab.example.com
 *   roles         'Jefe de Área', 'Director' (only when no non-demo user holds them)
 *   areas         codigo DEMO-LAB, DEMO-CAL, DEMO-ADM, DEMO-MTO
 *   rules         nombre 'Jefe de área' (orden 1), 'Dirección' (orden 2), 'Finanzas / Gerencia' (orden 3)
 *   budgets       the budgets of the demo areas
 *   requisitions  titulo starting with '[DEMO] '
 * NOT removed by --reset: request types (GENERAL, REPUESTO, PAPELERIA, SERVICIO: they are product defaults), the
 * requisition counter (numbers are never reused), notification rules and notifications already delivered.
 */

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TENANT = 'bmlab';
export const DEMO_TAG = '[DEMO] ';
export const DEMO_EMAIL_DOMAIN = 'bmlab.example.com';

// ------------------------------------------------------------------------------------------------ pure: args + safety

/** Parses argv (without node/script). Throws on unknown flags so a typo never silently runs a real seed. */
export function parseArgs(argv = []) {
  const opts = { dryRun: false, confirm: false, reset: false, forceRemote: false, tenant: DEFAULT_TENANT };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--confirm') opts.confirm = true;
    else if (arg === '--reset') opts.reset = true;
    else if (arg === '--force-remote') opts.forceRemote = true;
    else if (arg.startsWith('--tenant=')) {
      const t = arg.slice('--tenant='.length).trim().toLowerCase();
      if (!t) throw new Error('--tenant requiere un valor');
      opts.tenant = t;
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return opts;
}

/** Hosts of a mongodb:// URI (all members of a seed list). `mongodb+srv` is always remote. */
export function mongoHosts(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(String(uri || '').trim());
  if (!m) return null;
  return m[1].split(',').map((h) => h.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase());
}

export function isLocalMongoUri(uri) {
  const hosts = mongoHosts(uri);
  return Boolean(hosts) && hosts.length > 0 && hosts.every((h) => h === 'localhost' || h === '127.0.0.1' || h === '::1');
}

/** Throws when it is not safe to write: production, or a non-local database without --force-remote. */
export function assertSafeEnvironment({ nodeEnv, mongoUri, forceRemote = false } = {}) {
  if (String(nodeEnv || '').toLowerCase() === 'production') {
    throw new Error('Rechazado: NODE_ENV=production. Este seed es solo para desarrollo local.');
  }
  if (!isLocalMongoUri(mongoUri) && !forceRemote) {
    throw new Error('Rechazado: MONGO_URI no es localhost/127.0.0.1. (--force-remote existe pero NO lo usamos.)');
  }
}

/** Decides what a CLI invocation does; throws when a real write lacks --confirm. */
export function resolveMode(opts) {
  if (opts.dryRun) return opts.reset ? 'reset-dry' : 'seed-dry';
  if (!opts.confirm) throw new Error('Falta --confirm (o usa --dry-run para ver el plan sin escribir).');
  return opts.reset ? 'reset' : 'seed';
}

export function generatePassword() {
  // 18 url-safe chars + fixed suffix so it always has upper, lower, digit and symbol.
  return `${crypto.randomBytes(14).toString('base64url').slice(0, 18)}-A9!`;
}

// ------------------------------------------------------------------------------------------------ pure: the demo spec

const ROLE_PERMISSIONS = Object.freeze([
  'requisiciones:read', 'requisiciones:create', 'requisiciones:update', 'requisiciones:send', 'requisiciones:approve',
  'requisiciones:cancel', 'requisiciones:delete',
  'areas:read', 'budgets:read', 'request-types:read', 'approval-rules:read', 'inventario:read', 'users:read',
]);

export const DEMO_ROLES = Object.freeze([
  { name: 'Jefe de Área', description: 'Demo: jefe de área, crea y aprueba requisiciones (sin manage-all).', permissions: ROLE_PERMISSIONS },
  { name: 'Director', description: 'Demo: dirección, aprueba el segundo nivel (sin manage-all).', permissions: ROLE_PERMISSIONS },
]);

export const DEMO_USERS = Object.freeze([
  { key: 'jefe', email: `jefe.lab@${DEMO_EMAIL_DOMAIN}`, firstName: 'Jefe de', lastName: 'Laboratorio', roleName: 'Jefe de Área', areaCodigo: 'DEMO-LAB' },
  { key: 'director', email: `director@${DEMO_EMAIL_DOMAIN}`, firstName: 'Director', lastName: 'Demo', roleName: 'Director', areaCodigo: 'DEMO-ADM' },
]);

// jefes: 'jefe' = Jefe de Laboratorio, 'admin' = the tenant admin (David), 'director'.
export const DEMO_AREAS = Object.freeze([
  { codigo: 'DEMO-LAB', nombre: 'Laboratorio', descripcion: 'Análisis clínicos y control de calidad interno', jefes: ['jefe'] },
  { codigo: 'DEMO-CAL', nombre: 'Calidad', descripcion: 'Aseguramiento de la calidad y auditorías', jefes: ['jefe'] },
  { codigo: 'DEMO-ADM', nombre: 'Administración', descripcion: 'Compras, facturación y servicios generales', jefes: ['director'] },
  { codigo: 'DEMO-MTO', nombre: 'Mantenimiento', descripcion: 'Mantenimiento y calibración de equipos', jefes: ['admin'] },
]);

// Three people only (admin, jefe, director), and one person decides one level: requisitions above the level-3 floor
// could not be completed, so the demo ones stay below it (documented in docs/requisiciones.md).
export const DEMO_REGLAS = Object.freeze([
  { orden: 1, nombre: 'Jefe de área', montoDesde: 0, montoHasta: 1000000, aprobadorTipo: 'jefe_area' },
  { orden: 2, nombre: 'Dirección', montoDesde: 1000000, montoHasta: 10000000, aprobadorTipo: 'rol', rolName: 'Director' },
  { orden: 3, nombre: 'Finanzas / Gerencia', montoDesde: 10000000, montoHasta: null, aprobadorTipo: 'usuarios', usuarios: ['admin'] },
]);

// Monthly (current month) and yearly budget per area, COP. Tuned to the requisitions below:
//  Laboratorio ~4.86M committed+consumed of 5.5M (88% -> alert), Mantenimiento 1.67M consumed of 1.5M (overspent).
export const DEMO_PRESUPUESTOS = Object.freeze([
  { areaCodigo: 'DEMO-LAB', mensual: 5500000, anual: 48000000, umbralAlerta: 80 },
  { areaCodigo: 'DEMO-CAL', mensual: 800000, anual: 12000000, umbralAlerta: 80 },
  { areaCodigo: 'DEMO-ADM', mensual: 2000000, anual: 24000000, umbralAlerta: 80 },
  { areaCodigo: 'DEMO-MTO', mensual: 1500000, anual: 18000000, umbralAlerta: 80 },
]);

const line = (descripcion, unidad, cantidadSolicitada, precioEstimado, especificaciones) =>
  ({ descripcion, unidad, cantidadSolicitada, precioEstimado, ...(especificaciones ? { especificaciones } : {}) });

/**
 * ~9 requisitions. `por` = creator key; `flow` = real transitions run in order, each by an actor key.
 * `linea.inventario: true` is replaced by the stock item when the tenant has usesInventoryBasic, else by `fallback`.
 */
export const DEMO_REQUISICIONES = Object.freeze([
  {
    titulo: `${DEMO_TAG}Papelería y etiquetas de rotulación del laboratorio`, por: 'jefe', area: 'DEMO-LAB', tipo: 'PAPELERIA', prioridad: 'Baja', dias: 15,
    justificacion: 'Reposición mensual de papelería para registro de muestras y rotulación de tubos.',
    lineas: [
      line('Resma de papel carta 75 g', 'resma', 10, 18000),
      line('Marcador permanente punta fina negro', 'und', 24, 2500),
      line('Etiquetas adhesivas para tubos (rollo x 1000)', 'rollo', 20, 9500, 'Resistentes a refrigeración'),
    ],
    flow: [],
  },
  {
    titulo: `${DEMO_TAG}Tóner e insumos de oficina para facturación`, por: 'admin', area: 'DEMO-ADM', tipo: 'PAPELERIA', prioridad: 'Media', dias: 20,
    justificacion: 'El tóner de la impresora de facturación está por agotarse.',
    lineas: [
      line('Tóner impresora láser monocromática', 'und', 2, 285000),
      line('Resma de papel oficio', 'resma', 15, 19000),
      line('Carpeta de archivo A-Z', 'und', 30, 3200),
    ],
    flow: [],
  },
  {
    titulo: `${DEMO_TAG}Reactivos de química clínica y puntas de pipeta`, por: 'admin', area: 'DEMO-LAB', tipo: 'GENERAL', prioridad: 'Alta', dias: 7,
    justificacion: 'Consumo de reactivos del mes por encima de lo proyectado; el stock cubre solo 8 días.',
    lineas: [
      line('Reactivo de glucosa enzimática (kit 4 x 100 mL)', 'kit', 2, 190000),
      line('Tiras reactivas de orina (frasco x 100)', 'frasco', 3, 85000),
      line('Puntas de pipeta 200 µL (caja x 1000)', 'caja', 5, 42000),
    ],
    flow: [{ op: 'send', by: 'admin' }],
  },
  {
    titulo: `${DEMO_TAG}Repuestos para analizador de hematología`, por: 'admin', area: 'DEMO-LAB', tipo: 'REPUESTO', prioridad: 'Urgente', dias: 5,
    justificacion: 'El analizador presenta lecturas inestables; el fabricante recomienda cambiar lámpara y filtros.',
    lineas: [
      line('Lámpara halógena para analizador de hematología', 'und', 2, 1150000, 'Referencia del fabricante, 12 V / 20 W'),
      { inventario: true, cantidadSolicitada: 2, fallback: line('Filtro de aire para analizador', 'und', 2, 95000) },
    ],
    flow: [{ op: 'send', by: 'admin' }, { op: 'approve', by: 'jefe', observacion: 'Aprobado: el equipo es crítico para la operación.' }],
  },
  {
    titulo: `${DEMO_TAG}Calibración de micropipetas y balanza analítica`, por: 'jefe', area: 'DEMO-MTO', tipo: 'SERVICIO', prioridad: 'Media', dias: 30,
    justificacion: 'Calibración anual exigida por el programa de metrología (trazabilidad de los resultados).',
    lineas: [
      line('Calibración de micropipetas (certificado ISO 17025)', 'und', 12, 85000),
      line('Calibración de balanza analítica', 'und', 1, 650000),
    ],
    flow: [
      { op: 'send', by: 'jefe' },
      { op: 'approve', by: 'admin', observacion: 'Aprobado nivel jefe de mantenimiento.' },
      { op: 'approve', by: 'director', observacion: 'Aprobado por Dirección.' },
    ],
  },
  {
    titulo: `${DEMO_TAG}Kit de mantenimiento preventivo de centrífuga`, por: 'admin', area: 'DEMO-LAB', tipo: 'REPUESTO', prioridad: 'Media', dias: 25,
    justificacion: 'Mantenimiento preventivo semestral de la centrífuga de rutina.',
    lineas: [line('Kit de mantenimiento (escobillas, rodamientos y empaques) para centrífuga', 'kit', 1, 780000)],
    flow: [{ op: 'send', by: 'admin' }, { op: 'approve', by: 'jefe', observacion: 'De acuerdo con el plan de mantenimiento.' }],
  },
  {
    titulo: `${DEMO_TAG}Auditoría externa de calidad`, por: 'admin', area: 'DEMO-CAL', tipo: 'SERVICIO', prioridad: 'Baja', dias: 60,
    justificacion: 'Auditoría externa de seguimiento del sistema de gestión de calidad.',
    lineas: [line('Auditoría externa de seguimiento (1 día)', 'servicio', 1, 950000)],
    flow: [
      { op: 'send', by: 'admin' },
      { op: 'reject', by: 'jefe', observacion: 'El presupuesto de Calidad del mes no lo cubre; reprogramar para el próximo trimestre.' },
    ],
  },
  {
    titulo: `${DEMO_TAG}Compresor para refrigerador de reactivos`, por: 'jefe', area: 'DEMO-MTO', tipo: 'REPUESTO', prioridad: 'Alta', dias: 10,
    justificacion: 'El refrigerador de reactivos no mantiene la temperatura de 2-8 °C.',
    lineas: [line('Compresor para refrigerador de laboratorio 1/4 HP', 'und', 1, 1350000)],
    flow: [
      { op: 'send', by: 'jefe' },
      { op: 'cancel', by: 'jefe', motivo: 'Se encontró un compresor compatible en bodega; ya no se requiere la compra.' },
    ],
  },
  {
    titulo: `${DEMO_TAG}Sillas ergonómicas para el área de toma de muestras`, por: 'admin', area: 'DEMO-LAB', tipo: 'GENERAL', prioridad: 'Baja', dias: 45,
    justificacion: 'Las sillas actuales no cumplen con las recomendaciones de ergonomía de la ARL.',
    lineas: [line('Silla ergonómica con apoyabrazos', 'und', 4, 220000)],
    flow: [
      { op: 'send', by: 'admin' },
      { op: 'reject', by: 'jefe', observacion: 'Cotizar con al menos dos proveedores y reducir la cantidad a tres sillas.' },
      { op: 'reopen', by: 'admin', observacion: 'Se ajusta según lo solicitado.' },
      {
        op: 'edit',
        by: 'admin',
        data: {
          justificacion: 'Las sillas actuales no cumplen con la ergonomía de la ARL. Cotización de dos proveedores adjunta; se reduce a tres sillas.',
          lineas: [line('Silla ergonómica con apoyabrazos (cotización proveedor B)', 'und', 3, 210000)],
        },
      },
      { op: 'send', by: 'admin' },
    ],
  },
]);

/** Expected final state per requisition (documentation + assertions in the run). */
export const DEMO_ESTADOS_ESPERADOS = Object.freeze([
  'Borrador', 'Borrador', 'En_Aprobacion', 'En_Aprobacion', 'Aprobada', 'Aprobada', 'Rechazada', 'Cancelada', 'En_Aprobacion',
]);

/**
 * Idempotent plan: what exists in `snapshot` is skipped. `snapshot` is a set of keys per kind:
 *   { users:Set<email>, roles:Set<name>, areas:Set<codigo>, reglas:Set<orden>, presupuestos:Set<`codigo|periodo`>,
 *     requisiciones:Set<titulo> }
 * @returns {{ items: {kind:string,key:string,exists:boolean}[], toCreate: number, existing: number }}
 */
export function planDemo(snapshot = {}, { periodoMes = '0000-00', periodoAnio = '0000' } = {}) {
  const has = (kind, key) => Boolean(snapshot[kind] && snapshot[kind].has(key));
  const items = [];
  const add = (kind, key) => items.push({ kind, key, exists: has(kind, key) });
  DEMO_ROLES.forEach((r) => add('roles', r.name));
  DEMO_USERS.forEach((u) => add('users', u.email));
  DEMO_AREAS.forEach((a) => add('areas', a.codigo));
  DEMO_REGLAS.forEach((r) => add('reglas', String(r.orden)));
  DEMO_PRESUPUESTOS.forEach((p) => { add('presupuestos', `${p.areaCodigo}|${periodoMes}`); add('presupuestos', `${p.areaCodigo}|${periodoAnio}`); });
  DEMO_REQUISICIONES.forEach((r) => add('requisiciones', r.titulo));
  const existing = items.filter((i) => i.exists).length;
  return { items, toCreate: items.length - existing, existing };
}

export function summarizePlan(plan) {
  const out = {};
  for (const i of plan.items) {
    out[i.kind] = out[i.kind] || { create: 0, existing: 0 };
    out[i.kind][i.exists ? 'existing' : 'create'] += 1;
  }
  return out;
}

/**
 * Orchestrator, testable with fake `deps`:
 *   deps.readSnapshot(tenantId) -> snapshot, deps.periodos() -> { periodoMes, periodoAnio },
 *   deps.apply(tenantId, plan) -> result, deps.reset(tenantId, { dryRun }) -> result
 */
export async function runDemo({ deps, tenantId, mode }) {
  if (mode === 'reset' || mode === 'reset-dry') {
    const result = await deps.reset(tenantId, { dryRun: mode === 'reset-dry' });
    return { mode, tenantId, result };
  }
  const snapshot = await deps.readSnapshot(tenantId);
  const plan = planDemo(snapshot, deps.periodos());
  if (mode === 'seed-dry') return { mode, tenantId, plan, summary: summarizePlan(plan), result: null };
  const result = plan.toCreate === 0 && !deps.alwaysApply ? { created: 0, noop: true } : await deps.apply(tenantId, plan);
  return { mode, tenantId, plan, summary: summarizePlan(plan), result };
}

// ------------------------------------------------------------------------------------------------ real deps (lazy)

/** Loads the app modules AFTER emails are forced off (env.js reads process.env at import time). */
async function loadApp() {
  process.env.NOTIFICATIONS_ENABLED = 'false';
  const m = {};
  const imp = async (name, path) => { m[name] = await import(path); };
  await imp('env', '../src/config/env.js');
  await imp('Tenant', '../src/models/tenant.model.js');
  await imp('User', '../src/models/user.model.js');
  await imp('Role', '../src/models/role.model.js');
  await imp('Area', '../src/models/area.model.js');
  await imp('Tipo', '../src/models/tipoRequisicion.model.js');
  await imp('Regla', '../src/models/reglaAprobacion.model.js');
  await imp('Presupuesto', '../src/models/presupuestoArea.model.js');
  await imp('Requisicion', '../src/models/requisicion.model.js');
  await imp('Inventario', '../src/models/inventarioRepuesto.model.js');
  await imp('NotificationRule', '../src/models/notificationRule.model.js');
  await imp('roleService', '../src/services/role.service.js');
  await imp('userService', '../src/services/user.service.js');
  await imp('areaService', '../src/services/area.service.js');
  await imp('tipoService', '../src/services/tipoRequisicion.service.js');
  await imp('reglaService', '../src/services/reglaAprobacion.service.js');
  await imp('presupuestoService', '../src/services/presupuestoArea.service.js');
  await imp('reqService', '../src/services/requisicion.service.js');
  await imp('approvalService', '../src/services/requisicionApproval.service.js');
  await imp('notify', '../src/services/requisicionNotify.service.js');
  await imp('constants', '../src/constants/requisicion.constants.js');
  await imp('period', '../src/utils/requisicionPeriod.util.js');
  return m;
}

function currentPeriodos(m, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const mo = parts.find((p) => p.type === 'month').value;
  return { periodoMes: `${y}-${mo}`, periodoAnio: y };
}

const log = (...a) => console.log('[seed-demo-requisiciones]', ...a);

export function createRealDeps(m, { password } = {}) {
  const T = (tenantId) => ({ tenantId });
  const periodos = () => currentPeriodos(m);

  async function readSnapshot(tenantId) {
    const { periodoMes, periodoAnio } = periodos();
    const emails = DEMO_USERS.map((u) => u.email);
    const [users, roles, areas, reglas, requisiciones] = await Promise.all([
      m.User.User.find({ tenantId, email: { $in: emails } }).select('email').lean(),
      m.Role.Role.find({ tenantId, name: { $in: DEMO_ROLES.map((r) => r.name) } }).select('name').lean(),
      m.Area.Area.find({ tenantId, codigo: { $in: DEMO_AREAS.map((a) => a.codigo) } }).select('codigo').lean(),
      m.Regla.ReglaAprobacion.find({ tenantId, nombre: { $in: DEMO_REGLAS.map((r) => r.nombre) } }).select('orden nombre').lean(),
      m.Requisicion.Requisicion.find({ tenantId, titulo: { $regex: `^${DEMO_TAG.replace(/[[\]]/g, '\\$&')}` } }).setOptions({ includeDeleted: true }).select('titulo').lean(),
    ]);
    const areaDocs = areas;
    const presupuestos = areaDocs.length
      ? await m.Presupuesto.PresupuestoArea.find({ tenantId, areaId: { $in: areaDocs.map((a) => a._id) } }).select('areaId periodo').lean()
      : [];
    const codeById = new Map(areaDocs.map((a) => [String(a._id), a.codigo]));
    void periodoMes; void periodoAnio;
    return {
      users: new Set(users.map((u) => u.email)),
      roles: new Set(roles.map((r) => r.name)),
      areas: new Set(areaDocs.map((a) => a.codigo)),
      reglas: new Set(reglas.filter((r) => DEMO_REGLAS.some((d) => d.nombre === r.nombre && d.orden === r.orden)).map((r) => String(r.orden))),
      presupuestos: new Set(presupuestos.map((p) => `${codeById.get(String(p.areaId))}|${p.periodo}`)),
      requisiciones: new Set(requisiciones.map((r) => r.titulo)),
    };
  }

  async function ensureNotificationRules(tenantId) {
    let created = 0;
    const events = ['requisicion.submitted', 'requisicion.approval.requested', 'requisicion.level.approved', 'requisicion.approved',
      'requisicion.rejected', 'requisicion.withdrawn', 'requisicion.cancelled'];
    for (const event of events) {
      if (await m.NotificationRule.NotificationRule.exists({ tenantId, event })) continue;
      // in-app only: this script never enables the email channel.
      await m.NotificationRule.NotificationRule.create({ tenantId, event, recipients: { roles: [], userIds: [] }, channels: ['inapp'], enabled: true });
      created += 1;
    }
    return created;
  }

  async function apply(tenantId) {
    const tenant = await m.Tenant.Tenant.findOne({ tenantId }).lean();
    const caps = tenant.capabilities || {};
    const counts = { roles: 0, users: 0, areas: 0, tipos: 0, reglas: 0, presupuestos: 0, requisiciones: 0, notificationRules: 0 };
    const { periodoMes, periodoAnio } = periodos();
    const warnings = [];
    const credentials = [];

    const admin = await m.User.User.findOne({ tenantId, role: 'admin' }).sort({ createdAt: 1 }).lean();
    if (!admin) throw new Error(`El tenant '${tenantId}' no tiene un usuario admin`);

    counts.notificationRules = await ensureNotificationRules(tenantId);

    // (a) roles
    const roleByName = new Map();
    for (const def of DEMO_ROLES) {
      let role = await m.Role.Role.findOne({ tenantId, name: def.name }).lean();
      if (!role) {
        await m.roleService.roleService.create(tenantId, { name: def.name, description: def.description, permissions: [...def.permissions] });
        role = await m.Role.Role.findOne({ tenantId, name: def.name }).lean();
        counts.roles += 1;
      }
      roleByName.set(def.name, role);
    }

    // (a) users (real creation path: password hashed by the model; a given password means no welcome email)
    const userByKey = new Map([['admin', admin]]);
    for (const def of DEMO_USERS) {
      let user = await m.User.User.findOne({ tenantId, email: def.email }).lean();
      if (!user) {
        await m.userService.userService.create({
          tenantId, email: def.email, password, firstName: def.firstName, lastName: def.lastName,
          fullName: `${def.firstName} ${def.lastName}`, role: 'user', roleId: roleByName.get(def.roleName)._id, mustChangePassword: false,
        });
        user = await m.User.User.findOne({ tenantId, email: def.email }).lean();
        counts.users += 1;
        credentials.push(def.email);
      }
      userByKey.set(def.key, user);
    }

    // (b) areas
    const areaByCodigo = new Map();
    for (const def of DEMO_AREAS) {
      let area = await m.Area.Area.findOne({ tenantId, codigo: def.codigo }).lean();
      if (!area) {
        await m.areaService.areaService.create(tenantId, {
          codigo: def.codigo, nombre: def.nombre, descripcion: def.descripcion, activa: true,
          jefesIds: def.jefes.map((k) => String(userByKey.get(k)._id)),
        });
        area = await m.Area.Area.findOne({ tenantId, codigo: def.codigo }).lean();
        counts.areas += 1;
      }
      areaByCodigo.set(def.codigo, area);
    }
    for (const def of DEMO_USERS) {
      const area = areaByCodigo.get(def.areaCodigo);
      const user = userByKey.get(def.key);
      if (String(user.areaId || '') !== String(area._id)) {
        await m.userService.userService.update(user._id, { tenantId, areaId: area._id });
      }
    }

    // (c) request types: product defaults
    const tipoByCodigo = new Map();
    for (const def of m.constants.DEFAULT_TIPOS_REQUISICION) {
      let tipo = await m.Tipo.TipoRequisicion.findOne({ tenantId, codigo: def.codigo }).lean();
      if (!tipo) {
        await m.tipoService.tipoRequisicionService.create(tenantId, { codigo: def.codigo, nombre: def.nombre, activo: true });
        tipo = await m.Tipo.TipoRequisicion.findOne({ tenantId, codigo: def.codigo }).lean();
        counts.tipos += 1;
      }
      tipoByCodigo.set(def.codigo, tipo);
    }

    // (d) approval rules (one doc per level)
    for (const def of DEMO_REGLAS) {
      const exists = await m.Regla.ReglaAprobacion.findOne({ tenantId, orden: def.orden, nombre: def.nombre }).lean();
      if (exists) continue;
      const data = { orden: def.orden, nombre: def.nombre, montoDesde: def.montoDesde, montoHasta: def.montoHasta, aprobadorTipo: def.aprobadorTipo, activo: true };
      if (def.rolName) data.rolId = String(roleByName.get(def.rolName)._id);
      if (def.usuarios) data.usuariosIds = def.usuarios.map((k) => String(userByKey.get(k)._id));
      await m.reglaService.reglaAprobacionService.create(tenantId, data);
      counts.reglas += 1;
    }

    // (e) budgets: monthly (current month) + yearly per area
    for (const def of DEMO_PRESUPUESTOS) {
      const area = areaByCodigo.get(def.areaCodigo);
      for (const [periodo, monto] of [[periodoMes, def.mensual], [periodoAnio, def.anual]]) {
        const exists = await m.Presupuesto.PresupuestoArea.findOne({ tenantId, areaId: area._id, periodo }).lean();
        if (exists) continue;
        await m.presupuestoService.presupuestoAreaService.create(tenantId, { areaId: String(area._id), periodo, monto, umbralAlerta: def.umbralAlerta });
        counts.presupuestos += 1;
      }
    }

    // (f) requisitions through the real service functions
    const stock = caps.usesInventoryBasic
      ? await m.Inventario.InventarioRepuesto.findOne({ tenantId }).sort({ createdAt: 1 }).lean()
      : null;
    if (!stock) warnings.push('Sin capacidad usesInventoryBasic o sin ítems de inventario: la línea ligada a inventario se crea como texto libre.');
    const actorOf = (key) => {
      const u = userByKey.get(key);
      return { userId: String(u._id), name: u.fullName || u.email, canManageAll: false };
    };
    const versionOf = async (id) => (await m.Requisicion.Requisicion.findOne({ _id: id, tenantId }).select('version').lean()).version ?? 1;

    for (const def of DEMO_REQUISICIONES) {
      const dup = await m.Requisicion.Requisicion.findOne({ tenantId, titulo: def.titulo }).setOptions({ includeDeleted: true }).select('_id').lean();
      if (dup) continue;
      const lineas = def.lineas.map((l) => {
        if (!l.inventario) return { ...l };
        return stock ? { inventarioItemId: String(stock._id), cantidadSolicitada: l.cantidadSolicitada } : { ...l.fallback };
      });
      const creator = actorOf(def.por);
      await m.reqService.requisicionService.create(tenantId, creator.userId, {
        titulo: def.titulo,
        tipoRequisicionId: String(tipoByCodigo.get(def.tipo)._id),
        areaId: String(areaByCodigo.get(def.area)._id),
        prioridad: def.prioridad,
        fechaRequerida: new Date(Date.now() + def.dias * 86400000),
        justificacion: def.justificacion,
        lineas,
      }, caps);
      const doc = await m.Requisicion.Requisicion.findOne({ tenantId, titulo: def.titulo }).select('_id').lean();
      const id = String(doc._id);
      for (const step of def.flow) {
        const actor = actorOf(step.by);
        if (step.op === 'send') await m.reqService.requisicionService.enviar(tenantId, id, actor, {});
        else if (step.op === 'approve') await m.approvalService.requisicionApprovalService.approve(tenantId, id, actor, { version: await versionOf(id), observacion: step.observacion });
        else if (step.op === 'reject') await m.approvalService.requisicionApprovalService.reject(tenantId, id, actor, { version: await versionOf(id), observacion: step.observacion });
        else if (step.op === 'reopen') await m.reqService.requisicionService.reabrir(tenantId, id, actor, { observacion: step.observacion });
        else if (step.op === 'edit') await m.reqService.requisicionService.update(tenantId, actor.userId, id, step.data, caps, {});
        else if (step.op === 'cancel') await m.reqService.requisicionService.cancelar(tenantId, id, actor, { motivo: step.motivo });
        else throw new Error(`Paso desconocido: ${step.op}`);
      }
      counts.requisiciones += 1;
      log(`requisición creada: ${def.titulo}`);
    }
    await m.notify.flushRequisicionNotifications();
    return { created: Object.values(counts).reduce((a, b) => a + b, 0), counts, warnings, credentials, password: credentials.length ? password : null };
  }

  /** Deletes ONLY the demo records (see the header). Native deletes: the Requisicion model forbids physical deletion. */
  async function reset(tenantId, { dryRun }) {
    const emails = DEMO_USERS.map((u) => u.email);
    const users = await m.User.User.find({ tenantId, email: { $in: emails } }).setOptions({ includeDeleted: true }).select('_id roleId').lean();
    const areas = await m.Area.Area.find({ tenantId, codigo: { $in: DEMO_AREAS.map((a) => a.codigo) } }).setOptions({ includeDeleted: true }).select('_id').lean();
    const areaIds = areas.map((a) => a._id);
    const reqFilter = { tenantId, titulo: { $regex: '^\\[DEMO\\] ' } };
    const found = {
      requisiciones: await m.Requisicion.Requisicion.collection.countDocuments(reqFilter),
      presupuestos: await m.Presupuesto.PresupuestoArea.collection.countDocuments({ tenantId, areaId: { $in: areaIds } }),
      reglas: await m.Regla.ReglaAprobacion.collection.countDocuments({ tenantId, $or: DEMO_REGLAS.map((r) => ({ orden: r.orden, nombre: r.nombre })) }),
      areas: areaIds.length,
      users: users.length,
    };
    const userIds = users.map((u) => u._id);
    const demoRoleNames = DEMO_ROLES.map((r) => r.name);
    const roles = await m.Role.Role.find({ tenantId, name: { $in: demoRoleNames } }).select('_id').lean();
    const roleIds = roles.map((r) => r._id);
    const foreignHolders = roleIds.length
      ? await m.User.User.countDocuments({ tenantId, roleId: { $in: roleIds }, _id: { $nin: userIds } })
      : 0;
    found.roles = foreignHolders === 0 ? roleIds.length : 0;
    if (foreignHolders > 0) log(`Los roles demo los usa otro usuario (${foreignHolders}): no se borran.`);
    if (dryRun) return { dryRun: true, wouldDelete: found };

    await m.Requisicion.Requisicion.collection.deleteMany(reqFilter);
    await m.Presupuesto.PresupuestoArea.collection.deleteMany({ tenantId, areaId: { $in: areaIds } });
    await m.Regla.ReglaAprobacion.collection.deleteMany({ tenantId, $or: DEMO_REGLAS.map((r) => ({ orden: r.orden, nombre: r.nombre })) });
    if (userIds.length) await m.User.User.collection.updateMany({ _id: { $in: userIds } }, { $unset: { areaId: '' } });
    await m.Area.Area.collection.deleteMany({ tenantId, codigo: { $in: DEMO_AREAS.map((a) => a.codigo) } });
    await m.User.User.collection.deleteMany({ tenantId, email: { $in: emails } });
    if (foreignHolders === 0 && roleIds.length) await m.Role.Role.collection.deleteMany({ tenantId, _id: { $in: roleIds } });
    return { dryRun: false, deleted: found };
  }

  return { readSnapshot, periodos, apply, reset, T };
}

// ------------------------------------------------------------------------------------------------ CLI

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mode = resolveMode(opts);
  // Emails OFF before any app module is imported (env.js reads it at import time).
  process.env.NOTIFICATIONS_ENABLED = 'false';
  // The app logger is chatty (socket is not running in a script); keep only errors unless the caller sets LOG_LEVEL.
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'error';
  const { default: dotenv } = await import('dotenv');
  dotenv.config();
  assertSafeEnvironment({ nodeEnv: process.env.NODE_ENV, mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/timtto', forceRemote: opts.forceRemote });

  const m = await loadApp();
  const { default: mongoose } = await import('mongoose');
  await mongoose.connect(m.env.env.MONGO_URI);
  try {
    const tenant = await m.Tenant.Tenant.findOne({ tenantId: opts.tenant }).lean();
    if (!tenant) throw new Error(`Tenant '${opts.tenant}' no encontrado`);
    if (!tenant.capabilities?.usesRequisiciones) throw new Error(`El tenant '${opts.tenant}' no tiene usesRequisiciones habilitado`);
    log(`tenant=${opts.tenant} modo=${mode} db=${mongoose.connection.name}`);

    const generated = !process.env.DEMO_PASSWORD;
    const password = process.env.DEMO_PASSWORD || generatePassword();
    const deps = createRealDeps(m, { password });
    const out = await runDemo({ deps, tenantId: opts.tenant, mode });

    if (out.plan) {
      log('Plan (crear / ya existen):');
      for (const [kind, s] of Object.entries(out.summary)) log(`  ${kind}: crear=${s.create} existentes=${s.existing}`);
    }
    if (out.result) log('Resultado:', JSON.stringify({ ...out.result, password: undefined }));
    for (const w of out.result?.warnings || []) log(`AVISO: ${w}`);
    if (out.result?.credentials?.length) {
      log('Usuarios demo creados:', out.result.credentials.join(', '));
      log(`Contraseña (${generated ? 'generada' : 'de DEMO_PASSWORD'}; se muestra UNA sola vez): ${generated ? password : '(la de DEMO_PASSWORD)'}`);
    }
    if (mode === 'seed-dry' || mode === 'reset-dry') log('DRY-RUN: no se escribió nada.');
  } finally {
    await mongoose.disconnect();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('[seed-demo-requisiciones] ERROR:', err.message || err);
    process.exit(1);
  });
}
