import { buildTimelineEvent } from '../models/requisicion.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { multiplyMoney, sumMoney, toCents } from '../utils/money.util.js';
import { findDistinctAssignment } from '../utils/approverAssignment.util.js';
import { REQUISICION_TZ_OFFSET, REQUISICION_TIMEZONE } from '../constants/requisicion.constants.js';
import { getNextOrdenCompraNumero } from './counter.service.js';
import { requisicionApprovalService } from './requisicionApproval.service.js';
import { atomicWrite, transition } from './requisicionTransition.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import {
  ENTREGA_ESTADO,
  LINEA_ESTADO,
  NIVEL_ESTADO,
  OC_CONDICIONES_MAX,
  OC_ESTADO,
  OC_MARGEN_REAPROBACION_DEFAULT,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../constants/requisicion.constants.js';
import { assertEstado, assertModule, loadRequisicion, oidOf, sid, trimStr } from './requisicionLicitacion.shared.js';

/**
 * Purchase order (OC) of the winning supplier (change: requisiciones-e4-oc-recepcion, tasks 1.4 / 1.8).
 *  - `emitir`: real unit price per active line, total computed HERE, atomic yearly number, excess check against the
 *    estimate (+ margin) and the approval levels still to approve, all in ONE conditional write `Adjudicada -> OC_Emitida`
 *    (or `OC_En_Reaprobacion` when the excess needs the rule levels).
 *  - `editar`: only `OC_Emitida`, by the issuer or manage-all; bumps the OC `version`.
 *  - `aprobar` / `rechazar`: separation of duties (the issuer never decides), writes pinned to the state AND to the OC
 *    version / current level, so two simultaneous decisions end in one success and one 409 CONFLICTO_CONCURRENTE.
 * Notifications run after the write and never undo it.
 */

const sepFunciones = (msg) => new ApiError(403, msg, 'SEPARACION_DE_FUNCIONES');
const conflict = () => new ApiError(409, 'La orden de compra cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
const plainNivel = (n) => (n && typeof n.toObject === 'function' ? n.toObject() : { ...n });

/** Start of the current day in America/Bogota. */
function startOfTodayBogota(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: REQUISICION_TIMEZONE });
  return new Date(`${ymd}T00:00:00.000${REQUISICION_TZ_OFFSET}`);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Delivery date: a valid date that is not before today (America/Bogota). A date-only `YYYY-MM-DD` is that calendar day in
 * America/Bogota (stored at its local midnight, so the PDF and the e-mail print the SAME day); a full ISO timestamp is kept.
 */
export function parseFechaEntrega(value, now = new Date()) {
  let d;
  const m = typeof value === 'string' ? DATE_ONLY_RE.exec(value.trim()) : null;
  if (m) {
    d = new Date(`${value.trim()}T00:00:00.000${REQUISICION_TZ_OFFSET}`);
    // reject impossible days such as 2026-02-30 (the Date would roll over to March)
    if (!Number.isNaN(d.getTime()) && d.toLocaleDateString('en-CA', { timeZone: REQUISICION_TIMEZONE }) !== value.trim()) d = new Date(NaN);
  } else {
    d = value instanceof Date ? value : new Date(value);
  }
  if (!value || Number.isNaN(d.getTime())) throw new ApiError(400, 'La fecha de entrega es obligatoria y debe ser una fecha válida', 'FECHA_ENTREGA_INVALIDA');
  if (d.getTime() < startOfTodayBogota(now).getTime()) throw new ApiError(400, 'La fecha de entrega no puede ser anterior a hoy', 'FECHA_ENTREGA_INVALIDA');
  return d;
}

/**
 * Pure. Excess = total above `estimado x (1 + margen)` (the boundary itself is NOT excess) or an estimate of 0 ("Sin
 * estimar" lines). Compared in integer cents with BigInt so the exact margin is never lost to floating point.
 */
export function computeExceso({ estimado, total, margenPct }) {
  const est = Number(estimado) || 0;
  const tot = Number(total) || 0;
  const margen = Number.isFinite(Number(margenPct)) ? Number(margenPct) : OC_MARGEN_REAPROBACION_DEFAULT;
  let requerido;
  if (!(est > 0)) {
    requerido = true;
  } else {
    const margenBp = BigInt(Math.round(margen * 100)); // basis points of a percent
    requerido = BigInt(toCents(tot)) * 10000n > BigInt(toCents(est)) * (10000n + margenBp);
  }
  return { requerido, estimado: est, total: tot, margenPct: margen };
}

/**
 * Validates the payload lines against the requisition: exactly one real price per ACTIVE line, none repeated or
 * foreign. Quantities come from the requisition, never from the payload. Returns the OC lines and the total.
 */
export function buildOcLines(doc, input = []) {
  const active = (doc.lineas || []).filter((l) => l.estadoLinea !== LINEA_ESTADO.CANCELADA);
  const byId = new Map(active.map((l) => [sid(l.lineaId), l]));
  const prices = new Map();
  for (const it of Array.isArray(input) ? input : []) {
    const key = sid(it?.lineaId);
    if (!byId.has(key)) throw new ApiError(400, 'La línea indicada no pertenece a la requisición o está cancelada', 'LINEA_NO_ENCONTRADA', { lineaId: key });
    if (prices.has(key)) throw new ApiError(400, 'Línea repetida en la orden de compra', 'LINEA_REPETIDA', { lineaId: key });
    const price = it.precioUnitario;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e12) {
      throw new ApiError(400, 'El precio unitario debe ser un número mayor o igual a cero', 'PRECIO_INVALIDO', { lineaId: key });
    }
    prices.set(key, price);
  }
  const missing = active.filter((l) => !prices.has(sid(l.lineaId)));
  if (missing.length > 0 || active.length === 0) {
    throw new ApiError(400, 'Falta el precio unitario de una o más líneas activas', 'PRECIO_FALTANTE', { lineaIds: missing.map((l) => sid(l.lineaId)) });
  }
  const lineas = active.map((l) => {
    const precioUnitario = prices.get(sid(l.lineaId));
    return {
      lineaId: oidOf(l.lineaId),
      descripcion: l.descripcion,
      cantidad: l.cantidadSolicitada,
      precioUnitario,
      subtotal: multiplyMoney(l.cantidadSolicitada, precioUnitario),
    };
  });
  return { lineas, total: sumMoney(lineas.map((l) => l.subtotal)) };
}

export class RequisicionOrdenCompraService {
  // Seam for tests (ESM bindings are immutable).
  deps = { notify: notifyRequisicion, approval: requisicionApprovalService };

  async _margen(tenantId) {
    const t = await Tenant.findOne({ tenantId }).select('requisiciones').lean();
    const m = t?.requisiciones?.margenReaprobacionOcPct;
    return Number.isFinite(m) ? m : OC_MARGEN_REAPROBACION_DEFAULT;
  }

  /** Common validation of an issue / edit payload (everything that can fail before any write). */
  async _prepare(tenantId, doc, data, issuerId, extraExcluded = []) {
    const { lineas, total } = buildOcLines(doc, data.lineas);
    const fechaEntrega = parseFechaEntrega(data.fechaEntrega);
    const condiciones = trimStr(data.condiciones);
    if (condiciones.length > OC_CONDICIONES_MAX) {
      throw new ApiError(400, `Las condiciones no pueden superar ${OC_CONDICIONES_MAX} caracteres`, 'CONDICIONES_LARGAS');
    }
    if (typeof data.requiereEntregables !== 'boolean') {
      throw new ApiError(400, 'Indica si la orden de compra exige entregables', 'REQUIERE_ENTREGABLES_INVALIDO');
    }
    const margenPct = await this._margen(tenantId);
    const exceso = computeExceso({ estimado: doc.montoEstimado, total, margenPct });
    let niveles = [];
    if (exceso.requerido) {
      // Levels still to approve for the REAL total: rules applicable to it that were not approved in the original approval.
      const aprobados = (doc.aprobacion?.niveles || []).filter((n) => n.estado === NIVEL_ESTADO.APROBADO && n.reglaId).map((n) => n.reglaId);
      niveles = await this.deps.approval.resolveLevelsFor(tenantId, doc, {
        monto: total,
        excludedIds: [issuerId, ...extraExcluded],
        skipReglaIds: aprobados,
        allowEmpty: true,
      });
    }
    return { lineas, total, fechaEntrega, condiciones, requiereEntregables: data.requiereEntregables, exceso, niveles };
  }

  _winnerOrFail(doc) {
    if (!doc.licitacion?.ganadorId) throw new ApiError(409, 'La requisición no tiene un proveedor ganador', 'SIN_GANADOR');
    return doc.licitacion.ganadorId;
  }

  // ------------------------------------------------------------------------------------------ issue

  async emitir(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.ADJUDICADA]);
    const ganadorId = this._winnerOrFail(doc);
    const p = await this._prepare(tenantId, doc, data, actor.userId);

    const prev = doc.ordenCompra?.numero ? doc.ordenCompra : null;
    const numero = prev ? prev.numero : (await getNextOrdenCompraNumero(tenantId)).numero;
    const version = prev ? (Number(prev.version) || 1) + 1 : 1;
    const now = new Date();
    const reaprobacion = p.niveles.length > 0;
    const block = {
      numero,
      version,
      estado: reaprobacion ? OC_ESTADO.EN_REAPROBACION : OC_ESTADO.EMITIDA,
      lineas: p.lineas,
      total: p.total,
      moneda: doc.moneda,
      ...(p.condiciones ? { condiciones: p.condiciones } : {}),
      fechaEntrega: p.fechaEntrega,
      requiereEntregables: p.requiereEntregables,
      emitidaPor: actor.userId,
      emitidaEn: now,
      exceso: p.exceso,
      aprobacion: { niveles: p.niveles, nivelActual: reaprobacion ? p.niveles[0].orden : null },
      aprobadaPor: null,
      aprobadaEn: null,
      envio: { enviadaEn: null },
      entrega: { estado: ENTREGA_ESTADO.PENDIENTE, archivos: [] },
    };
    const events = [buildTimelineEvent({
      tipo: EV.OC_EMITIDA, actorId: actor.userId, estadoAnterior: E.ADJUDICADA, estadoNuevo: E.OC_EMITIDA, fecha: now,
      datos: { numero, version, total: p.total, requiereEntregables: p.requiereEntregables },
    })];
    if (p.exceso.requerido) events.push(this._excesoEvent(actor, now, { numero, version }, p));
    let updated;
    try {
      updated = await transition(tenantId, id, {
        from: E.ADJUDICADA,
        via: reaprobacion ? [E.OC_EMITIDA] : [],
        to: reaprobacion ? E.OC_EN_REAPROBACION : E.OC_EMITIDA,
        extraFilter: {
          'licitacion.ganadorId': ganadorId,
          ...(prev ? { 'ordenCompra.version': prev.version } : { ordenCompra: { $exists: false } }),
        },
        events,
        set: { ordenCompra: block },
      });
    } catch (err) {
      if (err.code === 'CONFLICTO_CONCURRENTE') throw conflict();
      throw err;
    }
    const fresh = updated.toObject();
    this._notifyIssued(tenantId, fresh, actor, block, reaprobacion);
    logger.info('Requisicion OC emitida: ' + sid(id));
    return toPublicPopulated(fresh);
  }

  /**
   * OC_REAPROBACION_REQUERIDA: recorded whenever the total exceeds the estimate (+ margin) or the estimate was 0. When every
   * applicable rule level was already approved (nothing pending) the OC stays in OC_Emitida for the simple approve-po
   * approval and the event says so with `sinNivelesPendientes`.
   */
  _excesoEvent(actor, now, { numero, version }, p) {
    const sinNiveles = p.niveles.length === 0;
    return buildTimelineEvent({
      tipo: EV.OC_REAPROBACION_REQUERIDA, actorId: actor.userId, estadoAnterior: E.OC_EMITIDA, estadoNuevo: sinNiveles ? E.OC_EMITIDA : E.OC_EN_REAPROBACION, fecha: now,
      datos: {
        numero, version, estimado: p.exceso.estimado, total: p.total, margenPct: p.exceso.margenPct, niveles: p.niveles.length,
        ...(sinNiveles ? { sinNivelesPendientes: true } : {}),
      },
    });
  }

  _notifyIssued(tenantId, fresh, actor, block, reaprobacion) {
    const ctx = { actorId: actor.userId, actorName: actor.name, ocNumero: block.numero, issuerId: sid(actor.userId) };
    this.deps.notify(tenantId, 'requisicion.po.issued', fresh, ctx);
    const level = reaprobacion ? block.aprobacion.niveles[0] : null;
    this.deps.notify(tenantId, 'requisicion.po.approval.requested', fresh, { ...ctx, ...(level ? { nivel: level, approverLevel: level } : {}) });
  }

  // ------------------------------------------------------------------------------------------ edit

  async editar(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    const oc = doc.ordenCompra;
    if (!oc?.numero) throw new ApiError(404, 'La requisición no tiene orden de compra', 'ORDEN_COMPRA_NOT_FOUND');
    assertEstado(doc, [E.OC_EMITIDA]);
    if (!actor.canManageAll && sid(oc.emitidaPor) !== sid(actor.userId)) {
      throw new ApiError(403, 'Solo quien emitió la orden de compra (o un supervisor) puede editarla', 'SOLO_EMISOR');
    }
    const p = await this._prepare(tenantId, doc, data, oc.emitidaPor, [actor.userId]);
    const version = (Number(oc.version) || 1) + 1;
    const now = new Date();
    const reaprobacion = p.niveles.length > 0;
    const events = [buildTimelineEvent({
      tipo: EV.OC_EDITADA, actorId: actor.userId, estadoAnterior: E.OC_EMITIDA, estadoNuevo: E.OC_EMITIDA, fecha: now,
      datos: { numero: oc.numero, version, versionAnterior: oc.version, total: p.total, requiereEntregables: p.requiereEntregables },
    })];
    if (p.exceso.requerido) events.push(this._excesoEvent(actor, now, { numero: oc.numero, version }, p));
    const set = {
      'ordenCompra.version': version,
      // who rewrote this version: he cannot decide it (separation of duties), like the issuer
      'ordenCompra.editadaPor': actor.userId,
      'ordenCompra.estado': reaprobacion ? OC_ESTADO.EN_REAPROBACION : OC_ESTADO.EMITIDA,
      'ordenCompra.lineas': p.lineas,
      'ordenCompra.total': p.total,
      'ordenCompra.condiciones': p.condiciones,
      'ordenCompra.fechaEntrega': p.fechaEntrega,
      'ordenCompra.requiereEntregables': p.requiereEntregables,
      'ordenCompra.exceso': p.exceso,
      'ordenCompra.aprobacion.niveles': p.niveles,
      'ordenCompra.aprobacion.nivelActual': reaprobacion ? p.niveles[0].orden : null,
    };
    const extraFilter = { 'ordenCompra.version': oc.version };
    let updated;
    try {
      updated = reaprobacion
        ? await transition(tenantId, id, { from: E.OC_EMITIDA, to: E.OC_EN_REAPROBACION, extraFilter, events, set })
        : await atomicWrite(tenantId, id, { expectedEstado: E.OC_EMITIDA, extraFilter, events, set });
    } catch (err) {
      if (['TRANSICION_INVALIDA', 'CONFLICTO_CONCURRENTE'].includes(err.code)) throw conflict();
      throw err;
    }
    const fresh = updated.toObject();
    if (reaprobacion) {
      this.deps.notify(tenantId, 'requisicion.po.approval.requested', fresh, {
        actorId: actor.userId, actorName: actor.name, ocNumero: oc.numero, issuerId: sid(oc.emitidaPor), nivel: p.niveles[0], approverLevel: p.niveles[0],
      });
    }
    return toPublicPopulated(fresh);
  }

  // ------------------------------------------------------------------------------------------ decisions

  /**
   * Loads the OC and checks that `actor` can decide it now. Order: existence (404) -> state (409) -> OC version if given
   * (409 VERSION_DESACTUALIZADA) -> separation of duties (403) -> eligibility of the current level (403).
   */
  async _loadForDecision(tenantId, id, actor, version) {
    const doc = await loadRequisicion(tenantId, id);
    const oc = doc.ordenCompra;
    if (!oc?.numero) throw new ApiError(404, 'La requisición no tiene orden de compra', 'ORDEN_COMPRA_NOT_FOUND');
    assertEstado(doc, [E.OC_EMITIDA, E.OC_EN_REAPROBACION]);
    if (version !== undefined && version !== null && Number(version) !== (Number(oc.version) || 1)) {
      throw new ApiError(409, 'La orden de compra cambió desde que la abriste; recárgala para ver el contenido actual', 'VERSION_DESACTUALIZADA', {
        versionActual: oc.version, versionRecibida: version,
      });
    }
    if (sid(oc.emitidaPor) === sid(actor.userId) || (oc.editadaPor && sid(oc.editadaPor) === sid(actor.userId))) {
      throw sepFunciones('Quien emitió o editó la orden de compra no puede aprobarla ni rechazarla');
    }
    const niveles = (oc.aprobacion?.niveles || []).map(plainNivel);
    let nivel = null;
    if (doc.estado === E.OC_EMITIDA && !actor.canApprovePo) {
      // The simple approval is a purchase-order permission; `requisiciones:approve` alone only decides re-approval levels.
      throw new ApiError(403, 'Se requiere el permiso para aprobar órdenes de compra', 'FORBIDDEN');
    }
    if (doc.estado === E.OC_EN_REAPROBACION) {
      nivel = niveles.find((n) => n.orden === oc.aprobacion.nivelActual && n.estado === NIVEL_ESTADO.PENDIENTE);
      if (!nivel) throw new ApiError(409, 'La orden de compra no tiene un nivel de aprobación pendiente', 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
      if (niveles.some((n) => n.orden !== nivel.orden && sid(n.decididoPor) === sid(actor.userId))) {
        throw sepFunciones('Ya decidiste otro nivel de esta orden de compra');
      }
      if (!(await this.deps.approval.isEligible(tenantId, nivel, actor.userId))) {
        throw new ApiError(403, 'No eres aprobador elegible del nivel actual', 'APROBADOR_NO_ELEGIBLE', { nivel: nivel.orden });
      }
    }
    return { doc, oc, niveles, nivel };
  }

  /**
   * Can `userId` decide this requisition's OC right now? Same rule as the decision endpoints: OC_Emitida -> approve-po and not
   * the issuer / editor; OC_En_Reaprobacion -> eligible approver of the CURRENT level (approve-po alone does not decide a level).
   * Used to open the detail / PDF of a pending OC without `requisiciones:read`.
   */
  async puedeDecidir(tenantId, doc, userId, canApprovePo) {
    const oc = doc?.ordenCompra;
    if (!oc?.numero || !userId) return false;
    if (sid(oc.emitidaPor) === sid(userId) || (oc.editadaPor && sid(oc.editadaPor) === sid(userId))) return false;
    if (doc.estado === E.OC_EMITIDA) return Boolean(canApprovePo);
    if (doc.estado !== E.OC_EN_REAPROBACION) return false;
    const nivel = (oc.aprobacion?.niveles || []).map(plainNivel).find((n) => n.orden === oc.aprobacion.nivelActual && n.estado === NIVEL_ESTADO.PENDIENTE);
    return Boolean(nivel) && this.deps.approval.isEligible(tenantId, nivel, userId);
  }

  /** Remaining levels must still have a DISTINCT eligible approver once `actorId` decides (issuer, actor, deciders excluded). */
  async _assertKeepsFeasible(tenantId, oc, niveles, nivel, actorId) {
    const excluded = new Set([sid(oc.emitidaPor), sid(oc.editadaPor), sid(actorId)]);
    for (const n of niveles) if (n.decididoPor) excluded.add(sid(n.decididoPor));
    const remaining = niveles.filter((n) => n.estado === NIVEL_ESTADO.PENDIENTE && n.orden > nivel.orden);
    const levels = await this.deps.approval._pendingPools(tenantId, remaining, excluded);
    const result = findDistinctAssignment(levels.map((l) => ({ key: l.orden, ids: l.ids })));
    if (result.feasible) return;
    const byOrden = new Map(levels.map((l) => [l.orden, l]));
    const bloqueados = result.offending.map((orden) => ({ orden, nombre: byOrden.get(orden)?.nombre }));
    throw new ApiError(
      409,
      `No puedes aprobar este nivel: dejarías sin aprobador disponible a los niveles ${bloqueados.map((n) => `"${n.nombre ?? n.orden}"`).join(', ')}. Pide a otro aprobador elegible que lo apruebe.`,
      'APROBACION_BLOQUEARIA_NIVEL',
      { niveles: bloqueados, nivel: nivel.orden },
    );
  }

  async aprobar(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const { doc, oc, niveles, nivel } = await this._loadForDecision(tenantId, id, actor, data.version);
    const now = new Date();
    const observacion = trimStr(data.observacion) || undefined;
    const guard = { 'ordenCompra.version': oc.version };
    const ctx = { actorId: actor.userId, actorName: actor.name, ocNumero: oc.numero, issuerId: sid(oc.emitidaPor) };
    const approvedEvent = buildTimelineEvent({
      tipo: EV.OC_APROBADA, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: E.OC_APROBADA, fecha: now, observacion,
      datos: { numero: oc.numero, version: oc.version, total: oc.total },
    });
    let updated;
    try {
      if (doc.estado === E.OC_EMITIDA) {
        // A re-issued OC whose levels were rejected must be edited (re-issued to re-approval) before anyone can approve it.
        if (niveles.some((n) => n.estado !== NIVEL_ESTADO.APROBADO)) {
          throw new ApiError(409, 'La orden de compra requiere reaprobación; el emisor debe editarla para reiniciar los niveles', 'OC_REQUIERE_REAPROBACION');
        }
        updated = await transition(tenantId, id, {
          from: E.OC_EMITIDA,
          to: E.OC_APROBADA,
          extraFilter: guard,
          events: [approvedEvent],
          set: { 'ordenCompra.estado': OC_ESTADO.APROBADA, 'ordenCompra.aprobadaPor': actor.userId, 'ordenCompra.aprobadaEn': now },
        });
      } else {
        const next = niveles.filter((n) => n.estado === NIVEL_ESTADO.PENDIENTE && n.orden > nivel.orden).sort((a, b) => a.orden - b.orden)[0];
        if (next) await this._assertKeepsFeasible(tenantId, oc, niveles, nivel, actor.userId);
        const decided = niveles.map((n) => (n.orden === nivel.orden
          ? { ...n, estado: NIVEL_ESTADO.APROBADO, decididoPor: actor.userId, fecha: now, ...(observacion ? { observacion } : {}) }
          : n));
        const levelEvent = buildTimelineEvent({
          tipo: EV.NIVEL_APROBADO, actorId: actor.userId, estadoAnterior: E.OC_EN_REAPROBACION, estadoNuevo: E.OC_EN_REAPROBACION, fecha: now, observacion,
          datos: { nivel: nivel.orden, ordenCompra: oc.numero },
        });
        const levelGuard = { ...guard, 'ordenCompra.aprobacion.nivelActual': nivel.orden };
        if (next) {
          updated = await atomicWrite(tenantId, id, {
            expectedEstado: E.OC_EN_REAPROBACION,
            extraFilter: levelGuard,
            events: [levelEvent],
            set: { 'ordenCompra.aprobacion.niveles': decided, 'ordenCompra.aprobacion.nivelActual': next.orden },
          });
        } else {
          updated = await transition(tenantId, id, {
            from: E.OC_EN_REAPROBACION,
            to: E.OC_APROBADA,
            extraFilter: levelGuard,
            events: [levelEvent, { ...approvedEvent, estadoAnterior: E.OC_EN_REAPROBACION }],
            set: {
              'ordenCompra.estado': OC_ESTADO.APROBADA,
              'ordenCompra.aprobacion.niveles': decided,
              'ordenCompra.aprobacion.nivelActual': null,
              'ordenCompra.aprobadaPor': actor.userId,
              'ordenCompra.aprobadaEn': now,
            },
          });
        }
        if (next) {
          const fresh = updated.toObject();
          this.deps.notify(tenantId, 'requisicion.po.approval.requested', fresh, { ...ctx, nivel: next, approverLevel: next });
          return toPublicPopulated(fresh);
        }
      }
    } catch (err) {
      // The state / version / level were validated just before: a guard miss means a concurrent decision won.
      if (['TRANSICION_INVALIDA', 'CONFLICTO_CONCURRENTE'].includes(err.code)) throw conflict();
      throw err;
    }
    const fresh = updated.toObject();
    this.deps.notify(tenantId, 'requisicion.po.approved', fresh, ctx);
    logger.info('Requisicion OC aprobada: ' + sid(id));
    return toPublicPopulated(fresh);
  }

  async rechazar(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const observacion = trimStr(data.observacion);
    if (!observacion) throw new ApiError(400, 'La observación es obligatoria para rechazar la orden de compra', 'OBSERVACION_REQUERIDA');
    const { doc, oc, niveles, nivel } = await this._loadForDecision(tenantId, id, actor, data.version);
    const now = new Date();
    const guard = { 'ordenCompra.version': oc.version };
    const events = [];
    let updated;
    try {
      if (doc.estado === E.OC_EMITIDA) {
        events.push(buildTimelineEvent({
          tipo: EV.OC_RECHAZADA, actorId: actor.userId, estadoAnterior: E.OC_EMITIDA, estadoNuevo: E.ADJUDICADA, fecha: now, observacion,
          datos: { numero: oc.numero, version: oc.version, total: oc.total },
        }));
        updated = await transition(tenantId, id, { from: E.OC_EMITIDA, to: E.ADJUDICADA, extraFilter: guard, events });
      } else {
        const decided = niveles.map((n) => {
          if (n.orden === nivel.orden) return { ...n, estado: NIVEL_ESTADO.RECHAZADO, decididoPor: actor.userId, fecha: now, observacion };
          if (n.estado === NIVEL_ESTADO.PENDIENTE) return { ...n, estado: NIVEL_ESTADO.CANCELADO };
          return n;
        });
        events.push(
          buildTimelineEvent({
            tipo: EV.NIVEL_RECHAZADO, actorId: actor.userId, estadoAnterior: E.OC_EN_REAPROBACION, estadoNuevo: E.OC_EN_REAPROBACION, fecha: now, observacion,
            datos: { nivel: nivel.orden, ordenCompra: oc.numero },
          }),
          buildTimelineEvent({
            tipo: EV.OC_RECHAZADA, actorId: actor.userId, estadoAnterior: E.OC_EN_REAPROBACION, estadoNuevo: E.OC_EMITIDA, fecha: now, observacion,
            datos: { numero: oc.numero, version: oc.version, total: oc.total, nivel: nivel.orden },
          }),
        );
        updated = await transition(tenantId, id, {
          from: E.OC_EN_REAPROBACION,
          to: E.OC_EMITIDA,
          extraFilter: { ...guard, 'ordenCompra.aprobacion.nivelActual': nivel.orden },
          events,
          set: { 'ordenCompra.estado': OC_ESTADO.EMITIDA, 'ordenCompra.aprobacion.niveles': decided, 'ordenCompra.aprobacion.nivelActual': null },
        });
      }
    } catch (err) {
      if (['TRANSICION_INVALIDA', 'CONFLICTO_CONCURRENTE'].includes(err.code)) throw conflict();
      throw err;
    }
    const fresh = updated.toObject();
    this.deps.notify(tenantId, 'requisicion.po.rejected', fresh, {
      actorId: actor.userId, actorName: actor.name, reason: observacion, ocNumero: oc.numero, issuerId: sid(oc.emitidaPor),
    });
    return toPublicPopulated(fresh);
  }
}

export const requisicionOrdenCompraService = new RequisicionOrdenCompraService();
