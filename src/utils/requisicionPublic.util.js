import { Requisicion } from '../models/requisicion.model.js';

/**
 * Read-side shape of a requisition. Populate happens ONLY here (on plain objects built for the response); the
 * services never persist or re-use these populated copies. Only non-sensitive user fields are selected, so password
 * hashes / tokens can never leak.
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
]);

const stripPrivate = (obj) => {
  const out = { ...obj };
  delete out.isDeleted;
  delete out.deletedAt;
  delete out.__v;
  return out;
};

const freshPopulate = () => REQUISICION_POPULATE.map((p) => ({ ...p, ...(p.options ? { options: { ...p.options } } : {}) }));
const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc });

/** Plain object without the soft-delete bookkeeping (no populate). */
export function toPublic(doc) {
  if (!doc) return doc;
  return stripPrivate(plainOf(doc));
}

/** Like `toPublic`, with the references populated (`_id` is always kept). */
export async function toPublicPopulated(doc) {
  if (!doc) return doc;
  const populated = await Requisicion.populate(plainOf(doc), freshPopulate());
  return stripPrivate(populated);
}

/** Populated list (the rows are lean plain objects). */
export async function toPublicPopulatedList(rows) {
  if (!rows || rows.length === 0) return [];
  const populated = await Requisicion.populate(rows.map(plainOf), freshPopulate());
  return populated.map(stripPrivate);
}
