import { Requisicion } from '../models/requisicion.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { REQUISICION_TRANSICIONES } from '../constants/requisicion.constants.js';

/**
 * Single, atomic state-change writer of the requisitions module (design D2).
 *
 * Every state change (and every approval decision) is ONE conditional `findOneAndUpdate` through
 * `Requisicion.appendEvent`: the filter carries `{ _id, tenantId, estado: <expected> }` (+ optional extra guards such
 * as `aprobacion.nivelActual`), the `$set` and the timeline `$push` travel in the same write. A null result is
 * re-read to decide between 404 (not found / other tenant / deleted) and 409 (the document is no longer in the
 * state, or at the level, the caller read). There is no read-modify-write anywhere.
 */

/** Pure: is `from -> to` an allowed step of the state table? */
export function isTransitionAllowed(from, to) {
  const allowed = REQUISICION_TRANSICIONES[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Conditional write without a table check (used for decisions that keep the state, e.g. an intermediate approval
 * level). Prefer `transition` for anything that changes `estado`.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ expectedEstado: string, extraFilter?: object, events: object|object[], set?: object, unset?: object, inc?: object, session?: any }} opts
 * @returns {Promise<object>} the updated document
 * @throws {ApiError} 404 REQUISICION_NOT_FOUND | 409 CONFLICTO_CONCURRENTE | 409 TRANSICION_INVALIDA
 */
export async function atomicWrite(tenantId, id, { expectedEstado, extraFilter = {}, events, set, unset, inc, session, arrayFilters }) {
  const filter = { _id: id, tenantId, estado: expectedEstado, ...extraFilter };
  const updated = await Requisicion.appendEvent(filter, events, { set, unset, inc, session, arrayFilters });
  if (updated) return updated;

  const current = await Requisicion.findOne({ _id: id, tenantId }).select('estado').lean();
  if (!current) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
  if (current.estado === expectedEstado) {
    // Same state, so another writer changed the guarded part (approval level / content) between our read and write.
    throw new ApiError(409, 'La requisición cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE', { estadoActual: current.estado });
  }
  throw new ApiError(409, `La requisición está en estado ${current.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', {
    estadoActual: current.estado,
    estadoEsperado: expectedEstado,
  });
}

/**
 * The state transition. `from -> via... -> to` must follow the table step by step (so `Borrador -> Enviada ->
 * En_Aprobacion` is one write when the intermediate state is declared in `via`). Anything else is a 409
 * TRANSICION_INVALIDA before touching the database.
 *
 * @param {string} tenantId
 * @param {string} id
 * @param {{ from: string, via?: string[], to: string, events: object|object[], set?: object, unset?: object, extraFilter?: object, inc?: object, session?: any }} opts
 */
export async function transition(tenantId, id, { from, via = [], to, events, set = {}, unset, inc, extraFilter, session, arrayFilters }) {
  const chain = [from, ...via, to];
  for (let i = 0; i < chain.length - 1; i += 1) {
    if (!isTransitionAllowed(chain[i], chain[i + 1])) {
      throw new ApiError(409, `Transición no permitida: ${chain[i]} -> ${chain[i + 1]}`, 'TRANSICION_INVALIDA', {
        estadoActual: from,
        estadoDestino: to,
      });
    }
  }
  return atomicWrite(tenantId, id, {
    expectedEstado: from,
    extraFilter,
    events,
    set: { ...set, estado: to },
    unset,
    inc,
    session,
    arrayFilters,
  });
}
