import { PERMISSIONS } from '../constants/permissions.js';
import { redactOrdenCompra } from './requisicionOrdenCompraDto.util.js';

/**
 * Visibility of the supplier quotations in INTERNAL responses (E3, owner decision on F12). Quotations are commercial
 * information: only users with `requisiciones:manage-suppliers`, `requisiciones:select-winner` or the creator of the
 * requisition see `licitacion.proveedores[].cotizacion` (with `versiones`) and `correoEnvio`. Everybody else gets
 * `cotizacion: null`, `correoEnvio: null` and `tieneCotizacion` (so the UI can say "Cotización recibida").
 *
 * Applied at ONE point: the router-level response filter (`redactLicitacionQuotes.middleware.js`), so the list, the
 * detail and every mutation response honour it. The filter is fail-closed: any payload carrying
 * `licitacion.proveedores` is redacted unless the viewer is allowed.
 */

export function hasQuotePermission(user) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes(PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS) || perms.includes(PERMISSIONS.REQUISICIONES_SELECT_WINNER);
}

/**
 * E4: who may see the real prices of the purchase order: the purchasing / OC / deliverables permissions, manage-all, or the
 * creator of the requisition. Everybody else keeps the state and the dates but gets no prices, conditions or approval data.
 */
export function hasOrdenCompraPermission(user) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return [
    PERMISSIONS.REQUISICIONES_ISSUE_PO,
    PERMISSIONS.REQUISICIONES_APPROVE_PO,
    // an eligible level approver needs the prices to decide a re-approval
    PERMISSIONS.REQUISICIONES_APPROVE,
    PERMISSIONS.REQUISICIONES_MANAGE_DELIVERABLES,
    PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS,
    PERMISSIONS.REQUISICIONES_SELECT_WINNER,
    PERMISSIONS.REQUISICIONES_MANAGE_ALL,
  ].some((p) => perms.includes(p));
}

const idOf = (v) => (v === null || v === undefined ? '' : String(v?._id ?? v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** Event data that is quotation content (old events stored it; new ones never do). */
function redactTimeline(timeline) {
  return timeline.map((e) => {
    if (!e || !isObj(e.datos) || (e.datos.valorTotal === undefined && e.datos.moneda === undefined)) return e;
    const { valorTotal: _v, moneda: _m, ...datos } = e.datos;
    return { ...e, datos };
  });
}

/** E4: amounts of the purchase order events (total / estimate / margin) for viewers without access to purchasing. */
function redactOcTimeline(timeline) {
  return timeline.map((e) => {
    if (!e || typeof e.tipo !== 'string' || !e.tipo.startsWith('OC_') || !isObj(e.datos)) return e;
    const { total: _t, estimado: _e, margenPct: _m, ...datos } = e.datos;
    return { ...e, datos };
  });
}

function redactOc(r) {
  const out = { ...r };
  if (r.ordenCompra) out.ordenCompra = redactOrdenCompra(r.ordenCompra);
  if (Array.isArray(r.timeline)) out.timeline = redactOcTimeline(r.timeline);
  return out;
}

function redactRequisicion(r) {
  const out = {
    ...r,
    licitacion: {
      ...r.licitacion,
      proveedores: r.licitacion.proveedores.map((p) => ({
        ...p,
        correoEnvio: null,
        cotizacion: null,
        tieneCotizacion: p.tieneCotizacion ?? Boolean(p.cotizacion),
      })),
    },
  };
  if (Array.isArray(r.timeline)) out.timeline = redactTimeline(r.timeline);
  return out;
}

/** Returns `node` with every requisition inside redacted for `user` (does not mutate). */
export function redactQuotesFor(node, user, depth = 0) {
  if (Array.isArray(node)) return node.map((n) => redactQuotesFor(n, user, depth));
  if (!isObj(node)) return node;
  if (Array.isArray(node.licitacion?.proveedores)) {
    const isCreator = Boolean(user?.userId) && idOf(node.creadaPor) === String(user.userId);
    const quotesOk = hasQuotePermission(user) || isCreator;
    const ocOk = hasOrdenCompraPermission(user) || isCreator;
    const afterQuotes = quotesOk ? node : redactRequisicion(node);
    return ocOk ? afterQuotes : redactOc(afterQuotes);
  }
  if (depth >= 2) return node;
  let changed = false;
  const copy = {};
  for (const [k, v] of Object.entries(node)) {
    const nv = (isObj(v) || Array.isArray(v)) ? redactQuotesFor(v, user, depth + 1) : v;
    if (nv !== v) changed = true;
    copy[k] = nv;
  }
  return changed ? copy : node;
}
