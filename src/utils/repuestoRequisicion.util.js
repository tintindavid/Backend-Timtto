import { REPUESTO_DISPONIBILIDAD } from '../constants/requisicion.constants.js';

/**
 * Read-side shape of the requisition link of a spare-part request (change: requisiciones-e2-solicitudes-recepcion).
 *
 * `Repuestos.requisicion` and `stockDescontadoPor` are internal: the model's toJSON strips them, but `.lean()` lists
 * bypass toJSON, so every Repuestos read that leaves the service goes through `presentRepuesto`:
 *  - module ON  -> `requisicion = { requisicionId, consecutivo, lineaId, disponibilidad, cantidadConfirmada }` (only when linked);
 *  - module OFF -> the field never appears;
 *  - `stockDescontadoPor` never appears.
 */

/** Public summary of the link, or `undefined` when the solicitud is not linked. */
export function requisicionSummary(requisicion) {
  if (!requisicion || !requisicion.requisicionId) return undefined;
  return {
    requisicionId: requisicion.requisicionId,
    consecutivo: requisicion.consecutivo,
    lineaId: requisicion.lineaId,
    disponibilidad: requisicion.disponibilidad,
    cantidadConfirmada: Number(requisicion.cantidadConfirmada) || 0,
  };
}

/**
 * @param {object} row  a lean object, a Mongoose document or a plain object
 * @param {boolean} moduleOn  tenant has `usesRequisiciones`
 */
export function presentRepuesto(row, moduleOn) {
  if (!row) return row;
  const isDoc = typeof row.toJSON === 'function' && typeof row.toObject === 'function';
  const source = isDoc ? row.toObject() : row;
  const out = isDoc ? row.toJSON() : { ...source };
  delete out.stockDescontadoPor;
  delete out.requisicion;
  if (moduleOn) {
    const summary = requisicionSummary(source.requisicion);
    if (summary) out.requisicion = summary;
  }
  return out;
}

export const presentRepuestos = (rows, moduleOn) => (rows || []).map((r) => presentRepuesto(r, moduleOn));

/**
 * Mongo filter for the `requisicionEstado` query of GET /repuestos (module ON only):
 * `sin` = not linked, `con` = linked, otherwise the exact `disponibilidad`.
 */
export function requisicionEstadoFilter(value) {
  if (!value) return null;
  if (value === 'sin') return { 'requisicion.requisicionId': { $exists: false } };
  if (value === 'con') return { 'requisicion.requisicionId': { $exists: true } };
  return { 'requisicion.disponibilidad': value };
}

export const isDisponible = (row) => row?.requisicion?.disponibilidad === REPUESTO_DISPONIBILIDAD.DISPONIBLE;
