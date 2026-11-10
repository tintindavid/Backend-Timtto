import mongoose from 'mongoose';
import { Requisicion } from '../models/requisicion.model.js';
import { Area } from '../models/area.model.js';
import { Customer } from '../models/customer.model.js';
import { requireTenant } from '../utils/tenant.util.js';
import { mapReportError, resolveRange, summarizeHours } from '../utils/requisicionReport.util.js';
import {
  METRICAS_TOP_N,
  OC_ESTADO,
  REPORTE_MAX_TIME_MS,
  REQUISICION_ESTADO,
  REQUISICION_EVENTO,
} from '../constants/requisicion.constants.js';

/**
 * Metrics of the module (change: requisiciones-e5-reporteria, task 1.4). Base set = requisitions CREATED in the range.
 * One aggregation: `$match` by tenant first, an early `$project` that keeps only the milestones, then a `$facet`.
 * Amounts are grouped by currency and never converted.
 */

const HOUR_MS = 60 * 60 * 1000;
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Milestone pairs of the cycle times: [key, from field, to field] (fields computed in the projection). */
export const CICLOS = Object.freeze([
  ['envioAprobacion', 'enviadaAt', 'aprobadaAt'],
  ['aprobacionAdjudicacion', 'aprobadaAt', 'adjudicadaAt'],
  ['adjudicacionOcEnviada', 'adjudicadaAt', 'ocEnviadaAt'],
  ['ocEnviadaCierre', 'ocEnviadaAt', 'cerradaAt'],
]);

const fechasDe = (...tipos) => ({
  $map: {
    input: { $filter: { input: { $ifNull: ['$timeline', []] }, as: 'e', cond: { $in: ['$$e.tipo', tipos] } } },
    as: 'e',
    in: '$$e.fecha',
  },
});
const cuenta = (...tipos) => ({
  $size: { $filter: { input: { $ifNull: ['$timeline', []] }, as: 'e', cond: { $in: ['$$e.tipo', tipos] } } },
});

/** `$match` of the base set. `proveedorId` is the effective winner of the requisition (computed before this match). */
export function buildBaseMatch(tenantId, range, { areaId, tipoId, moneda } = {}) {
  const match = { tenantId, isDeleted: { $ne: true }, createdAt: { $gte: range.from, $lte: range.to } };
  if (areaId) match.areaId = oid(areaId);
  if (tipoId) match.tipoRequisicionId = oid(tipoId);
  if (moneda) match.moneda = String(moneda).toUpperCase();
  return match;
}

/**
 * Top N PER CURRENCY (amounts of different currencies are never ranked against each other). Deterministic: value desc, then
 * the id asc; the names are resolved afterwards and re-sorted (value desc, name asc, id asc) in `_shape`.
 */
function topPorMoneda(match, idField, countKey) {
  return [
    { $match: match },
    { $group: { _id: { id: '$' + idField, moneda: '$oc.moneda' }, valor: { $sum: '$oc.total' }, [countKey]: { $sum: 1 } } },
    { $sort: { '_id.moneda': 1, valor: -1, '_id.id': 1 } },
    { $group: { _id: '$_id.moneda', items: { $push: { id: '$_id.id', valor: '$valor', [countKey]: '$' + countKey } } } },
    { $project: { items: { $slice: ['$items', METRICAS_TOP_N] } } },
    { $unwind: '$items' },
    { $replaceRoot: { newRoot: { moneda: '$_id', id: '$items.id', valor: '$items.valor', [countKey]: '$items.' + countKey } } },
  ];
}

/** Pipeline of the metrics (exported for tests). */
export function buildPipeline(tenantId, range, filters = {}) {
  const ocAprobada = {
    'oc.estado': { $in: [OC_ESTADO.APROBADA, OC_ESTADO.ENVIADA] },
    estado: { $ne: REQUISICION_ESTADO.CANCELADA },
  };
  const ciclo = ([, from, to]) => ([
    { $match: { [from]: { $ne: null }, [to]: { $ne: null } } },
    { $project: { _id: 0, horas: { $divide: [{ $subtract: [`$${to}`, `$${from}`] }, HOUR_MS] } } },
    { $match: { horas: { $gte: 0 } } },
  ]);
  const pipeline = [
    { $match: buildBaseMatch(tenantId, range, filters) },
    {
      $project: {
        estado: 1,
        areaId: 1,
        montoEstimado: { $ifNull: ['$montoEstimado', 0] },
        oc: { $cond: [{ $ifNull: ['$ordenCompra.numero', false] }, { estado: '$ordenCompra.estado', total: '$ordenCompra.total', moneda: '$ordenCompra.moneda' }, null] },
        ganador: {
          $first: {
            $filter: {
              input: { $ifNull: ['$licitacion.proveedores', []] },
              as: 'p',
              cond: { $eq: ['$$p._id', '$licitacion.ganadorId'] },
            },
          },
        },
        compraDirectaProveedorId: '$licitacion.compraDirecta.proveedorId',
        enviada: { $gt: [cuenta(REQUISICION_EVENTO.ENVIADA), 0] },
        rechazada: { $gt: [cuenta(REQUISICION_EVENTO.RECHAZADA, REQUISICION_EVENTO.NIVEL_RECHAZADO), 0] },
        devoluciones: cuenta(REQUISICION_EVENTO.DEVUELTA),
        enviadaAt: { $max: fechasDe(REQUISICION_EVENTO.ENVIADA) },
        aprobadaAt: { $max: fechasDe(REQUISICION_EVENTO.APROBADA) },
        adjudicadaAt: { $max: fechasDe(REQUISICION_EVENTO.PROVEEDOR_SELECCIONADO, REQUISICION_EVENTO.COMPRA_DIRECTA_JUSTIFICADA) },
        ocEnviadaAt: { $min: fechasDe(REQUISICION_EVENTO.OC_ENVIADA) },
        cerradaAt: { $max: fechasDe(REQUISICION_EVENTO.CERRADA) },
      },
    },
    { $addFields: { proveedorId: { $ifNull: ['$ganador.proveedorId', '$compraDirectaProveedorId'] } } },
  ];
  if (filters.proveedorId) pipeline.push({ $match: { proveedorId: oid(filters.proveedorId) } });
  pipeline.push({
    $facet: {
      total: [{ $count: 'n' }],
      porEstado: [{ $group: { _id: '$estado', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }],
      rechazo: [{ $group: { _id: null, enviadas: { $sum: { $cond: ['$enviada', 1, 0] } }, rechazadas: { $sum: { $cond: ['$rechazada', 1, 0] } } } }],
      ...Object.fromEntries(CICLOS.map((c) => [`ciclo_${c[0]}`, ciclo(c)])),
      valor: [
        { $match: ocAprobada },
        { $group: { _id: '$oc.moneda', total: { $sum: '$oc.total' }, ordenes: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ],
      estimadoReal: [
        { $match: { ...ocAprobada, montoEstimado: { $gt: 0 } } },
        { $group: { _id: '$oc.moneda', estimado: { $sum: '$montoEstimado' }, real: { $sum: '$oc.total' }, requisiciones: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ],
      sinEstimar: [{ $match: { ...ocAprobada, montoEstimado: { $lte: 0 } } }, { $count: 'n' }],
      devoluciones: [
        { $match: { devoluciones: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$devoluciones' }, requisiciones: { $sum: 1 } } },
      ],
      topProveedores: topPorMoneda({ ...ocAprobada, proveedorId: { $ne: null } }, 'proveedorId', 'ordenes'),
      topAreas: topPorMoneda(ocAprobada, 'areaId', 'requisiciones'),
    },
  });
  return pipeline;
}

/** Currency asc, value desc, name asc, id asc: a stable order for the response. */
const ranked = (rows, idKey) => rows.sort((x, y) => String(x.moneda).localeCompare(String(y.moneda))
  || y.valor - x.valor
  || String(x.nombre ?? '').localeCompare(String(y.nombre ?? ''), 'es')
  || String(x[idKey]).localeCompare(String(y[idKey])));

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class RequisicionMetricasService {
  /**
   * @param {string} tenantId
   * @param {{ desde?: string, hasta?: string, areaId?: string, tipoId?: string, proveedorId?: string, moneda?: string }} query
   */
  async obtener(tenantId, query = {}, now = new Date()) {
    requireTenant(tenantId);
    const range = resolveRange(query, now);
    let res;
    try {
      [res] = await Requisicion.aggregate(buildPipeline(tenantId, range, query)).option({ maxTimeMS: REPORTE_MAX_TIME_MS });
    } catch (err) {
      throw mapReportError(err);
    }
    return this._shape(tenantId, range, res || {});
  }

  async _shape(tenantId, range, res) {
    const areaIds = (res.topAreas || []).map((a) => a.id).filter(Boolean);
    const provIds = (res.topProveedores || []).map((p) => p.id).filter(Boolean);
    const [areas, provs] = await Promise.all([
      areaIds.length ? Area.find({ tenantId, _id: { $in: areaIds } }).select('nombre').setOptions({ includeDeleted: true }).lean() : [],
      provIds.length ? Customer.find({ tenantId, _id: { $in: provIds } }).select('Razonsocial').lean() : [],
    ]);
    const areaName = new Map(areas.map((a) => [String(a._id), a.nombre]));
    const provName = new Map(provs.map((p) => [String(p._id), p.Razonsocial]));
    const enviadas = res.rechazo?.[0]?.enviadas || 0;
    const rechazadas = res.rechazo?.[0]?.rechazadas || 0;
    return {
      rango: { desde: range.desde, hasta: range.hasta },
      total: res.total?.[0]?.n || 0,
      porEstado: (res.porEstado || []).map((e) => ({ estado: e._id, count: e.count })),
      tasaRechazo: { rechazadas, enviadas, tasa: enviadas > 0 ? Math.round((rechazadas / enviadas) * 10000) / 10000 : 0 },
      ciclos: Object.fromEntries(CICLOS.map(([key]) => [key, summarizeHours((res[`ciclo_${key}`] || []).map((r) => r.horas))])),
      valorComprado: (res.valor || []).map((v) => ({ moneda: v._id, total: money(v.total), ordenes: v.ordenes })),
      estimadoVsReal: (res.estimadoReal || []).map((v) => ({
        moneda: v._id,
        estimado: money(v.estimado),
        real: money(v.real),
        exceso: money(v.real - v.estimado),
        requisiciones: v.requisiciones,
      })),
      sinEstimar: { requisiciones: res.sinEstimar?.[0]?.n || 0 },
      devolucionesEntregables: { total: res.devoluciones?.[0]?.total || 0, requisiciones: res.devoluciones?.[0]?.requisiciones || 0 },
      topProveedores: ranked((res.topProveedores || []).map((p) => ({
        proveedorId: String(p.id),
        nombre: provName.get(String(p.id)) ?? null,
        moneda: p.moneda,
        valor: money(p.valor),
        ordenes: p.ordenes,
      })), 'proveedorId'),
      topAreas: ranked((res.topAreas || []).map((a) => ({
        areaId: String(a.id),
        nombre: areaName.get(String(a.id)) ?? null,
        moneda: a.moneda,
        valor: money(a.valor),
        requisiciones: a.requisiciones,
      })), 'areaId'),
    };
  }
}

export const requisicionMetricasService = new RequisicionMetricasService();
