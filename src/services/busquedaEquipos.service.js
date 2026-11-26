'use strict';

import { EquipoItem } from '../models/equipoitem.model.js';
import { Items } from '../models/items.model.js';
import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Servicios } from '../models/servicios.model.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';

/**
 * Tenant-scoped equipment search (change: buscador-equipos). Matching ignores case and the separators
 * (space - _ . /) on both sides; the user input is always regex-escaped.
 */

/** Model field -> `coincidencia.campo`, in matching priority order. */
const SEARCH_FIELDS = Object.freeze([
  ['Serie', 'serie'],
  ['Inventario', 'inventario'],
  ['Modelo', 'modelo'],
  ['Marca', 'marca'],
  ['Invima', 'invima'],
]);
const ALL_FIELDS = SEARCH_FIELDS.map(([field]) => field);
const IDENTIFIER_FIELDS = ['Serie', 'Inventario'];
const SEPARATORS = /[\s_./-]+/g;
const SEPARATOR_PATTERN = '[\\s_./-]*';
const SELECT = '_id ClienteId SedeId Servicio ItemId item Marca Modelo Serie Inventario Invima EstadoOperativo';

// Caps the size of the query built from one term.
const MAX_WORDS = 6;

export const stripSeparators = (value) => String(value ?? '').replace(SEPARATORS, '').toLowerCase();

const splitWords = (q) => String(q).split(/\s+/).map(stripSeparators).filter(Boolean).slice(0, MAX_WORDS);

/** Source of a pattern that finds `term` (already stripped) with any separators between its characters. */
const loosePattern = (term) => Array.from(term, (ch) => escapeRegex(ch)).join(SEPARATOR_PATTERN);

const anyField = (fields, regex) => ({ $or: fields.map((field) => ({ [field]: regex })) });

/**
 * One filter per ranking tier: exact serial/inventory, prefix, contains. Querying the tiers separately means a better
 * match is never lost to the cap of a weaker one.
 */
function buildTiers(q) {
  const whole = loosePattern(stripSeparators(q));
  return [
    anyField(IDENTIFIER_FIELDS, new RegExp(`^${SEPARATOR_PATTERN}${whole}${SEPARATOR_PATTERN}$`, 'i')),
    anyField(ALL_FIELDS, new RegExp(`^${SEPARATOR_PATTERN}${whole}`, 'i')),
    // Every word must match some field; this also covers "the whole term matches one field".
    { $and: splitWords(q).map((word) => anyField(ALL_FIELDS, new RegExp(loosePattern(word), 'i'))) },
  ];
}

/** The field that best explains why the equipment was returned. */
function findCoincidencia(equipo, q) {
  const term = stripSeparators(q);
  const words = splitWords(q).sort((a, b) => b.length - a.length);
  const tests = [
    (field, value) => IDENTIFIER_FIELDS.includes(field) && value === term,
    (_field, value) => value.startsWith(term),
    (_field, value) => value.includes(term),
    ...words.map((word) => (_field, value) => value.includes(word)),
  ];
  for (const test of tests) {
    const hit = SEARCH_FIELDS.find(([field]) => equipo[field] && test(field, stripSeparators(equipo[field])));
    if (hit) return { campo: hit[1], valor: String(equipo[hit[0]]) };
  }
  return { campo: 'serie', valor: String(equipo.Serie ?? '') };
}

/** Map id -> `field` of the tenant's documents among `ids`. */
async function lookup(Model, tenantId, ids, field) {
  const wanted = [...new Set(ids.filter(Boolean).map(String))];
  if (wanted.length === 0) return new Map();
  const docs = await Model.find({ tenantId, _id: { $in: wanted }, isDeleted: false }).select(field).lean();
  return new Map(docs.map((d) => [String(d._id), d[field] ?? null]));
}

export class BusquedaEquiposService {
  /**
   * @param {ReturnType<import('../utils/busquedaContext.util.js').buildBusquedaContext>} ctx
   * @param {{ q: string, limit?: number }} params  validated by busquedaEquiposQueryDto
   */
  async buscar(ctx, { q, limit = 8 }) {
    const base = { tenantId: ctx.tenantId, isDeleted: false, ...(ctx.clienteId ? { ClienteId: ctx.clienteId } : {}) };
    const found = new Map();
    for (const tier of buildTiers(q)) {
      if (found.size >= limit) break;
      // Rows of earlier tiers can come back again; `limit` rows still hold enough new ones to fill the list.
      const rows = await EquipoItem.find({ ...base, ...tier }).select(SELECT).sort({ Serie: 1, _id: 1 }).limit(limit).lean();
      for (const row of rows) {
        if (found.size >= limit) break;
        if (!found.has(String(row._id))) found.set(String(row._id), row);
      }
    }

    const equipos = [...found.values()];
    const [items, clientes, sedes, servicios] = await Promise.all([
      lookup(Items, ctx.tenantId, equipos.map((e) => e.ItemId), 'Nombre'),
      lookup(Customer, ctx.tenantId, equipos.map((e) => e.ClienteId), 'Razonsocial'),
      lookup(Sedes, ctx.tenantId, equipos.map((e) => e.SedeId), 'nombreSede'),
      lookup(Servicios, ctx.tenantId, equipos.map((e) => e.Servicio), 'nombre'),
    ]);

    return equipos.map((e) => {
      const clienteId = String(e.ClienteId);
      return {
        _id: String(e._id),
        nombre: items.get(String(e.ItemId)) || e.item || null,
        marca: e.Marca || null,
        modelo: e.Modelo || null,
        serie: e.Serie || null,
        inventario: e.Inventario || null,
        estadoOperativo: e.EstadoOperativo || null,
        cliente: clientes.has(clienteId) ? { _id: clienteId, nombre: clientes.get(clienteId) } : null,
        sede: sedes.get(String(e.SedeId)) || null,
        servicio: servicios.get(String(e.Servicio)) || null,
        coincidencia: findCoincidencia(e, q),
      };
    });
  }
}

export const busquedaEquiposService = new BusquedaEquiposService();
