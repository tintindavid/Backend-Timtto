import { Requisicion } from '../models/requisicion.model.js';
import '../models/repuestos.model.js';

/**
 * Read-side shape of a requisition. Populate happens ONLY here (on plain objects built for the response); the
 * services never persist or re-use these populated copies. Only non-sensitive user fields are selected, so password
 * hashes / tokens can never leak.
 *
 * E2 contract (detail and every write response):
 *  - `lineas[]._id` and `recepciones[]._id` mirror `lineaId` / `recepcionId` (the stored sub-documents carry no `_id`);
 *  - `lineas[].origenSolicitudRepuestoId` is populated as `{ _id, nombre, ResponsableSolicitud: { _id, firstName, lastName } }`;
 *  - `recepciones[].recibidaPor` and `recepciones[].items[].confirmacion.por` are populated as `{ _id, firstName, lastName }`.
 */
const USER_FULL = 'firstName lastName email';
const USER_NAME = 'firstName lastName';

// Users are populated with `includeDeleted`: a soft-deleted user keeps showing his name in the history instead of
// populating to null (N6). Only the non-sensitive fields above are selected either way.
const WITH_DELETED = Object.freeze({ includeDeleted: true });

export const REQUISICION_POPULATE = Object.freeze([
  { path: 'areaId', select: 'nombre codigo', model: 'Area' },
  { path: 'tipoRequisicionId', select: 'nombre codigo', model: 'TipoRequisicion' },
  { path: 'creadaPor', select: USER_FULL, model: 'User', options: WITH_DELETED },
  { path: 'solicitanteId', select: USER_FULL, model: 'User', options: WITH_DELETED },
  { path: 'aprobacion.niveles.decididoPor', select: USER_NAME, model: 'User', options: WITH_DELETED },
  { path: 'aprobacion.niveles.aprobadorIds', select: USER_NAME, model: 'User', options: WITH_DELETED },
  { path: 'timeline.actor.usuarioId', select: USER_NAME, model: 'User', options: WITH_DELETED },
  { path: 'recepciones.recibidaPor', select: USER_NAME, model: 'User', options: WITH_DELETED },
  { path: 'recepciones.items.confirmacion.por', select: USER_NAME, model: 'User', options: WITH_DELETED },
]);

const stripPrivate = (obj) => {
  const out = { ...obj };
  delete out.isDeleted;
  delete out.deletedAt;
  delete out.__v;
  delete out.solicitudesSyncPendiente; // internal reconcile marker
  if (Array.isArray(out.lineas)) {
    out.lineas = out.lineas.map((l) => (l && l._id === undefined && l.lineaId !== undefined ? { ...l, _id: l.lineaId } : l));
  }
  if (Array.isArray(out.recepciones)) {
    out.recepciones = out.recepciones.map((r) => (r && r._id === undefined && r.recepcionId !== undefined ? { ...r, _id: r.recepcionId } : r));
  }
  return out;
};

/** The origin solicitud is populated tenant-scoped, with only its name and its responsible user's public name. */
const origenPopulate = (tenantId) => ({
  path: 'lineas.origenSolicitudRepuestoId',
  select: 'nombre ResponsableSolicitud',
  model: 'Repuestos',
  ...(tenantId ? { match: { tenantId } } : {}),
  populate: { path: 'ResponsableSolicitud', select: USER_NAME, model: 'User', options: { ...WITH_DELETED } },
});

const freshPopulate = (tenantId) => [
  ...REQUISICION_POPULATE.map((p) => ({ ...p, ...(p.options ? { options: { ...p.options } } : {}) })),
  origenPopulate(tenantId),
];
const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc });

/** Plain object without the soft-delete bookkeeping (no populate). */
export function toPublic(doc) {
  if (!doc) return doc;
  return stripPrivate(plainOf(doc));
}

/** Like `toPublic`, with the references populated (`_id` is always kept). */
export async function toPublicPopulated(doc) {
  if (!doc) return doc;
  const plain = plainOf(doc);
  const populated = await Requisicion.populate(plain, freshPopulate(plain.tenantId));
  return stripPrivate(populated);
}

/** Populated list (the rows are lean plain objects). */
export async function toPublicPopulatedList(rows) {
  if (!rows || rows.length === 0) return [];
  const populated = await Requisicion.populate(rows.map(plainOf), freshPopulate(rows[0]?.tenantId));
  return populated.map(stripPrivate);
}
