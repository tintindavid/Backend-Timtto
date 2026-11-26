import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../../utils/apiError.util.js';

export const DEFAULT_CATALOG_PATH = fileURLToPath(new URL('../../fixtures/demo/catalogo-base.json', import.meta.url));

/** Parses a MongoDB export: a JSON array or one document per line. */
export function parseExport(text) {
  const body = String(text).replace(/^﻿/, '').trim();
  if (!body) return [];
  if (body.startsWith('[')) return JSON.parse(body);
  return body.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Extended JSON ({ $oid }) or plain string id. */
const asId = (value) => (value && typeof value === 'object' ? value.$oid ?? null : value ? String(value) : null);
const text = (value) => (value === undefined || value === null ? '' : String(value));

/**
 * Turns the raw export of ONE tenant into the demo base catalogue: only live records of that tenant, no prices, no
 * source ids; links are rewritten to opaque keys and broken ones are reported.
 *
 * @param {{ items, actividades, protocolos, protocoloActividades }} raw
 * @param {{ tenantId: string }} options
 * @returns {{ catalog: object, discarded: Array<{ type, name, reason }> }}
 */
export function sanitizeCatalog(raw, { tenantId }) {
  const discarded = [];
  const drop = (type, name, reason) => discarded.push({ type, name: text(name), reason });

  const live = (list, type, nameOf) => (list ?? []).filter((doc) => {
    if (doc.tenantId !== tenantId) { drop(type, nameOf(doc), 'otro tenant'); return false; }
    return doc.isDeleted !== true;
  });

  const actividadKeys = new Map();
  const actividades = live(raw.actividades, 'actividad', (d) => d.Nombre).map((d, i) => {
    const key = `a${i + 1}`;
    actividadKeys.set(asId(d._id), key);
    return {
      key,
      Nombre: text(d.Nombre),
      Descripcion: text(d.Descripcion),
      EsObligatoria: text(d.EsObligatoria),
      StatusReason: text(d.StatusReason),
    };
  });

  const protocoloKeys = new Map();
  const protocolos = live(raw.protocolos, 'protocolo', (d) => d.nombre).map((d, i) => {
    const key = `p${i + 1}`;
    protocoloKeys.set(asId(d._id), key);
    const refs = d.actividadesMtto ?? [];
    const found = refs.map((ref) => actividadKeys.get(asId(ref))).filter(Boolean);
    if (found.length < refs.length) drop('protocolo', d.nombre, `${refs.length - found.length} actividad(es) inexistentes o eliminadas`);
    return { key, nombre: text(d.nombre), Descripcion: text(d.Descripcion), actividadKeys: found };
  });

  const items = live(raw.items, 'item', (d) => d.Nombre).map((d, i) => {
    const protocoloKey = protocoloKeys.get(asId(d.ProtocoloId)) ?? null;
    if (d.ProtocoloId && !protocoloKey) drop('item', d.Nombre, 'protocolo inexistente: se carga sin protocolo');
    return { key: `i${i + 1}`, Nombre: text(d.Nombre), Observacion: text(d.Observacion), protocoloKey };
  });

  const protocoloActividades = [];
  for (const d of live(raw.protocoloActividades, 'protocolo-actividad', () => '')) {
    const protocoloKey = protocoloKeys.get(asId(d.ProtocoloId));
    const actividadKey = actividadKeys.get(asId(d.ActividadId));
    if (protocoloKey && actividadKey) protocoloActividades.push({ protocoloKey, actividadKey });
    else drop('protocolo-actividad', '', 'enlace roto');
  }

  return {
    catalog: { exportedAt: new Date().toISOString(), actividades, protocolos, items, protocoloActividades },
    discarded,
  };
}

/** Items that can be used for sample equipment: their protocol exists and has activities. */
export function itemsConProtocolo(catalog) {
  const usable = new Set((catalog.protocolos ?? []).filter((p) => p.actividadKeys?.length).map((p) => p.key));
  return (catalog.items ?? []).filter((i) => usable.has(i.protocoloKey));
}

/** Reads the versioned base catalogue; 503 DEMO_CATALOG_MISSING when it cannot be used. */
export function loadDemoCatalog(file = DEFAULT_CATALOG_PATH) {
  let catalog = null;
  try {
    catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    catalog = null;
  }
  if (!catalog || itemsConProtocolo(catalog).length === 0) {
    throw new ApiError(
      503,
      'No está disponible el catálogo base de las cuentas de demostración (src/fixtures/demo/catalogo-base.json)',
      'DEMO_CATALOG_MISSING',
    );
  }
  return catalog;
}
