/**
 * DB-free "world" for the requisitions services (project convention: no DB in unit tests).
 * Replaces the Mongoose statics the services touch with in-memory fakes. The Requisicion fake keeps the semantics
 * that matter: conditional atomic writes (filter incl. dotted paths), `$push.$each` of the timeline, the real
 * guard `findForbiddenRequisicionUpdate` on every update, and real schema validation on create.
 */
import mongoose from 'mongoose';
import { Requisicion, findForbiddenRequisicionUpdate } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { notificationService } from '../../src/services/notification.service.js';
import { stubModel } from './memoryModel.js';

export const oid = () => new mongoose.Types.ObjectId().toString();

function clone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object' && !v._bsontype) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = clone(x);
    return out;
  }
  return v;
}

const getPath = (doc, path) => path.split('.').reduce((acc, k) => {
  if (acc === undefined || acc === null) return undefined;
  if (Array.isArray(acc)) return acc.map((x) => x?.[k]);
  return acc[k];
}, doc);

function eq(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
}

function condMatch(actual, cond) {
  if (cond instanceof RegExp) return cond.test(String(actual));
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !cond._bsontype && Object.keys(cond).some((k) => k.startsWith('$'))) {
    const arr = Array.isArray(actual) ? actual : [actual];
    for (const [op, arg] of Object.entries(cond)) {
      if (op === '$elemMatch' && !arr.some((a) => a && typeof a === 'object' && matchDeep(a, arg))) return false;
      if (op === '$exists' && (actual !== undefined) !== Boolean(arg)) return false;
      if (op === '$in' && !arg.some((x) => (x === null ? arr.some((a) => a === null || a === undefined) : arr.some((a) => eq(a, x))))) return false;
      if (op === '$ne' && arr.some((a) => eq(a, arg))) return false;
      if (op === '$gte' && !(new Date(actual) >= arg)) return false;
      if (op === '$lte' && !(new Date(actual) <= arg)) return false;
    }
    return true;
  }
  if (Array.isArray(actual)) return actual.some((a) => eq(a, cond));
  if (cond === null) return actual === null || actual === undefined;
  return eq(actual, cond);
}

export function matchDeep(doc, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$expr') continue;
    if (k === '$and') { if (!v.every((f) => matchDeep(doc, f))) return false; continue; }
    if (k === '$or') { if (!v.some((f) => matchDeep(doc, f))) return false; continue; }
    if (!condMatch(getPath(doc, k), v)) return false;
  }
  return true;
}

function setPath(doc, path, value) {
  const keys = path.split('.');
  let cur = doc;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/** Dotted $set with positional identifiers ($[id]) resolved through arrayFilters, like MongoDB. */
function setWithFilters(doc, path, value, arrayFilters = []) {
  const keys = path.split('.');
  const walk = (cur, i) => {
    const k = keys[i];
    const m = /^\$\[(\w+)\]$/.exec(k);
    if (i === keys.length - 1) { cur[k] = value; return; }
    if (m) {
      for (const el of cur) {
        const mine = arrayFilters.filter((f) => Object.keys(f)[0].startsWith(m[1] + '.'));
        const ok = mine.every((f) => Object.entries(f).every(([fk, fv]) => condMatch(getPath(el, fk.slice(m[1].length + 1)), fv)));
        if (ok) walk(el, i + 1);
      }
      return;
    }
    if (cur[k] === undefined || cur[k] === null) cur[k] = {};
    walk(cur[k], i + 1);
  };
  walk(doc, 0);
}

function query(getResult) {
  const q = {
    select: () => q, sort: () => q, skip: () => q, limit: () => q, lean: () => q,
    then: (res, rej) => Promise.resolve().then(getResult).then(res, rej),
  };
  return q;
}

/**
 * @returns {{ rows: object[], db: object, writes: {count:number}, emits: object[], restore: () => void, ... }}
 */
export function createWorld({ tenantId = 'acme', failEmit = false } = {}) {
  const restores = [];
  const data = {
    requisiciones: [], areas: [], users: [], roles: [], items: [], reglas: [], tipos: [],
  };
  const world = { tenantId, ...data, writes: { count: 0 }, emits: [], lastFind: null, seqs: new Map(), clock: 1 };

  // --- other models via the shared stub -------------------------------------------------------------------
  restores.push(stubModel(Area, data.areas));
  restores.push(stubModel(User, data.users));
  restores.push(stubModel(Role, data.roles));
  restores.push(stubModel(InventarioRepuesto, data.items));
  restores.push(stubModel(ReglaAprobacion, data.reglas));
  restores.push(stubModel(TipoRequisicion, data.tipos));

  // --- tenant currency, counter ---------------------------------------------------------------------------
  const savedTenant = Tenant.findOne;
  Tenant.findOne = () => ({ lean: async () => ({ settings: { currency: 'COP' }, capabilities: { usesRequisiciones: true } }) });
  restores.push(() => { Tenant.findOne = savedTenant; });

  const savedCounter = Counter.findOneAndUpdate;
  Counter.findOneAndUpdate = (filter) => ({
    lean: async () => {
      await new Promise((r) => setImmediate(r)); // let parallel callers interleave
      const k = `${filter.tenantId}|${filter.key}`;
      world.seqs.set(k, (world.seqs.get(k) || 0) + 1);
      return { seq: world.seqs.get(k) };
    },
  });
  restores.push(() => { Counter.findOneAndUpdate = savedCounter; });

  // --- Requisicion fake -----------------------------------------------------------------------------------
  const rows = data.requisiciones;
  const saved = {};
  for (const n of ['appendEvent', 'findOne', 'find', 'countDocuments', 'create', 'findOneAndUpdate', 'populate']) saved[n] = Requisicion[n];
  const visible = (d) => !d.isDeleted;

  const tick = () => new Date(Date.UTC(2026, 0, 1) + (world.clock++) * 1000);

  // populate is a read-side concern (real Mongoose would query the stubbed models): identity here.
  Requisicion.populate = async (docs) => docs;
  Requisicion.findOne = (filter) => query(() => {
    const hit = rows.filter(visible).find((d) => matchDeep(d, filter));
    return hit ? clone(hit) : null;
  });
  Requisicion.find = (filter) => {
    world.lastFind = filter;
    return query(() => rows.filter(visible).filter((d) => matchDeep(d, filter)).map(clone));
  };
  Requisicion.countDocuments = (filter) => query(() => rows.filter(visible).filter((d) => matchDeep(d, filter)).length);
  Requisicion.create = async (input) => {
    const doc = new Requisicion(input);
    await doc.validate();
    const row = doc.toObject();
    row._id = row._id.toString();
    row.createdAt = tick();
    row.updatedAt = row.createdAt;
    rows.push(row);
    return clone(row);
  };
  Requisicion.appendEvent = (filter, events, extra = {}) => {
    if (!filter || !filter.tenantId) throw new Error('appendEvent requires tenantId');
    const list = Array.isArray(events) ? events : [events];
    const update = { $push: { timeline: { $each: list } } };
    const set = { ...(extra.set || {}) };
    const afs = [...(extra.arrayFilters || [])];
    const pushed = extra.pushRecepciones ? (Array.isArray(extra.pushRecepciones) ? extra.pushRecepciones : [extra.pushRecepciones]) : [];
    if (pushed.length) update.$push.recepciones = { $each: pushed };
    const extraFilter = [];
    if (extra.confirmarItem) {
      const { recepcionId, lineaId, confirmacion } = extra.confirmarItem;
      set['recepciones.$[rec].items.$[itm].confirmacion'] = confirmacion;
      afs.push({ 'rec.recepcionId': recepcionId }, { 'itm.lineaId': lineaId, 'itm.confirmacion': { $exists: false } });
      extraFilter.push({ recepciones: { $elemMatch: { recepcionId, items: { $elemMatch: { lineaId, confirmacion: { $exists: false } } } } } });
    }
    if (Object.keys(set).length) update.$set = set;
    if (extra.unset) update.$unset = extra.unset;
    if (extra.inc) update.$inc = extra.inc;
    const forbidden = findForbiddenRequisicionUpdate(update, { arrayFilters: afs });
    if (forbidden) throw forbidden;
    return query(() => {
      const hit = rows.filter(visible).find((d) => matchDeep(d, filter) && extraFilter.every((f) => matchDeep(d, f)));
      if (!hit) return null;
      world.writes.count += 1;
      for (const [p, v] of Object.entries(set)) setWithFilters(hit, p, clone(v), afs);
      for (const p of Object.keys(extra.unset || {})) setPath(hit, p, undefined);
      for (const [p, v] of Object.entries(extra.inc || {})) setPath(hit, p, (getPath(hit, p) || 0) + v);
      if (pushed.length) hit.recepciones = [...(hit.recepciones || []), ...pushed.map(clone)];
      hit.timeline = [...(hit.timeline || []), ...list.map(clone)];
      hit.updatedAt = tick();
      return clone(hit);
    });
  };
  Requisicion.findOneAndUpdate = (filter, update) => query(() => {
    const hit = rows.filter(visible).find((d) => matchDeep(d, filter));
    if (!hit) return null;
    for (const [p, v] of Object.entries(update.$set || {})) setPath(hit, p, v);
    return clone(hit);
  });
  restores.push(() => { for (const n of Object.keys(saved)) Requisicion[n] = saved[n]; });

  // --- notifications --------------------------------------------------------------------------------------
  const savedEmit = notificationService.emit;
  notificationService.emit = async (tId, event, payload, options) => {
    world.emits.push({ tenantId: tId, event, payload, options });
    if (failEmit) throw new Error('emit boom');
    return { dispatched: 0, recipients: [] };
  };
  restores.push(() => { notificationService.emit = savedEmit; });

  // --- builders -------------------------------------------------------------------------------------------
  world.addUser = (over = {}) => {
    const u = { _id: oid(), tenantId, isDeleted: false, roleId: null, ...over };
    data.users.push(u);
    return u;
  };
  world.addRole = (permissions = [], over = {}) => {
    const r = { _id: oid(), tenantId, permissions, isDeleted: false, ...over };
    data.roles.push(r);
    return r;
  };
  world.addArea = (jefesIds = [], over = {}) => {
    const a = { _id: oid(), tenantId, nombre: 'Mtto', codigo: 'MTTO', activa: true, jefesIds, isDeleted: false, ...over };
    data.areas.push(a);
    return a;
  };
  world.addTipo = (over = {}) => {
    const t = { _id: oid(), tenantId, codigo: 'GENERAL', nombre: 'General', activo: true, isDeleted: false, ...over };
    data.tipos.push(t);
    return t;
  };
  world.addRegla = (over = {}) => {
    const r = {
      _id: oid(), tenantId, orden: 1, nombre: 'Jefe de área', montoDesde: 0, montoHasta: null,
      aprobadorTipo: 'jefe_area', rolId: null, usuariosIds: [], activo: true, isDeleted: false, ...over,
    };
    data.reglas.push(r);
    return r;
  };
  world.addItem = (over = {}) => {
    const i = { _id: oid(), tenantId, nombre: 'Guante', referencia: 'G-1', unidad: 'caja', precio: 10, activo: true, isDeleted: false, ...over };
    data.items.push(i);
    return i;
  };
  /** Inserts a requisition document directly (bypasses the service) in any state. */
  world.seedRequisicion = (over = {}) => {
    const created = tick();
    const row = {
      _id: oid(), tenantId, consecutivo: `REQ-2026-${String(rows.length + 1).padStart(4, '0')}`, titulo: 'Compra',
      tipoRequisicionId: oid(), areaId: oid(), estado: 'Borrador', version: 1, creadaPor: oid(), solicitanteId: oid(),
      lineas: [{ lineaId: oid(), descripcion: 'Guantes', unidad: 'caja', cantidadSolicitada: 2, precioEstimado: 10, estadoLinea: 'Pendiente' }],
      montoEstimado: 20, moneda: 'COP', justificacion: 'Necesario', aprobacion: { niveles: [], nivelActual: null },
      timeline: [], isDeleted: false, createdAt: created, updatedAt: created, ...over,
    };
    rows.push(row);
    return row;
  };
  world.restore = () => { while (restores.length) restores.pop()(); };
  return world;
}
