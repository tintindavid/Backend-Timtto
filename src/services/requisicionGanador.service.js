import mongoose from 'mongoose';
import { Tenant } from '../models/tenant.model.js';
import { buildTimelineEvent } from '../models/requisicion.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { emailService } from './external/email.service.js';
import { transition } from './requisicionTransition.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import { syncRequisicionSolicitudesSafe } from './requisicionSolicitudSync.service.js';
import {
  COMPRA_DIRECTA_MIN_JUSTIFICACION,
  LICITACION_MAX_PROVEEDORES,
  PROVEEDOR_ENLACE_POST_CIERRE_DIAS,
  PROVEEDOR_ESTADO_ENVIO as PE,
  PROVEEDOR_ESTADOS_ACTIVOS,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
} from '../constants/requisicion.constants.js';
import {
  assertEstado, assertModule, findProveedor, isActivo, isValidEmail, loadProveedorCatalogo, loadRequisicion, oidOf, proveedoresOf, sid, trimStr,
} from './requisicionLicitacion.shared.js';

/**
 * Award of the tender (change: requisiciones-e3-compras-portal, task 2.3).
 *  - `seleccionarGanador`: ONE conditional write (state = Cotizacion_Recibida AND `ganadorId` still null): the chosen
 *    supplier becomes `Ganador`, the other active ones `Descartado` with their link expired, and the requisition
 *    `Adjudicada`. A racing second selection matches nothing and answers 409 GANADOR_YA_SELECCIONADO. Irreversible.
 *  - `compraDirecta`: from `Aprobada`, one catalogue supplier + a justification, by a user other than the creator.
 */

const CONFLICT = () => new ApiError(409, 'La requisición cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
const ALREADY = () => new ApiError(409, 'Ya se seleccionó un proveedor para esta requisición', 'GANADOR_YA_SELECCIONADO');

export class RequisicionGanadorService {
  deps = { email: emailService, notify: notifyRequisicion, sync: syncRequisicionSolicitudesSafe };

  async seleccionarGanador(tenantId, id, paId, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    if (doc.licitacion?.ganadorId) throw ALREADY();
    assertEstado(doc, [E.COTIZACION_RECIBIDA]);
    const winner = findProveedor(doc, paId);
    if (!isActivo(winner) || !winner.cotizacion) {
      throw new ApiError(400, 'Solo se puede elegir un proveedor que haya enviado su cotización', 'PROVEEDOR_SIN_COTIZACION');
    }
    const wid = oidOf(winner._id);
    const discarded = proveedoresOf(doc).filter((p) => sid(p._id) !== sid(wid) && isActivo(p));
    const now = new Date();
    let updated;
    try {
      updated = await transition(tenantId, id, {
        from: E.COTIZACION_RECIBIDA,
        to: E.ADJUDICADA,
        extraFilter: {
          'licitacion.ganadorId': null,
          'licitacion.proveedores': { $elemMatch: { _id: wid, estadoEnvio: { $in: PROVEEDOR_ESTADOS_ACTIVOS }, cotizacion: { $exists: true } } },
        },
        events: [
          buildTimelineEvent({ tipo: EV.PROVEEDOR_SELECCIONADO, actorId: actor.userId, estadoAnterior: E.COTIZACION_RECIBIDA, estadoNuevo: E.ADJUDICADA, fecha: now, datos: { paId: sid(wid), nombre: winner.nombre } }),
          ...discarded.map((p) => buildTimelineEvent({ tipo: EV.PROVEEDOR_DESCARTADO, actorId: actor.userId, estadoAnterior: E.COTIZACION_RECIBIDA, estadoNuevo: E.ADJUDICADA, fecha: now, datos: { paId: sid(p._id), nombre: p.nombre } })),
        ],
        set: {
          'licitacion.ganadorId': wid,
          'licitacion.proveedores.$[w].estadoEnvio': PE.GANADOR,
          // hard expiry of the winner's link (it keeps a read-only page for a while)
          'licitacion.proveedores.$[w].tokenVence': new Date(now.getTime() + PROVEEDOR_ENLACE_POST_CIERRE_DIAS * 86400000),
          'licitacion.proveedores.$[o].estadoEnvio': PE.DESCARTADO,
          'licitacion.proveedores.$[o].tokenVence': now,
        },
        arrayFilters: [{ 'w._id': wid }, { 'o._id': { $ne: wid }, 'o.estadoEnvio': { $in: PROVEEDOR_ESTADOS_ACTIVOS } }],
      });
    } catch (err) {
      if (err.code === 'TRANSICION_INVALIDA' || err.code === 'CONFLICTO_CONCURRENTE') {
        const fresh = await loadRequisicion(tenantId, id);
        if (fresh.licitacion?.ganadorId || fresh.estado === E.ADJUDICADA) throw ALREADY();
        if (fresh.estado === E.COTIZACION_RECIBIDA) throw CONFLICT();
      }
      throw err;
    }
    const fresh = updated.toObject();
    await this.deps.sync(tenantId, fresh, { actorId: actor.userId });
    this.deps.notify(tenantId, 'requisicion.winner.selected', fresh, { actorId: actor.userId, actorName: actor.name, proveedorNombre: winner.nombre });
    await this._avisarGanador(tenantId, fresh, winner.nombre, winner.correoEnvio);
    return toPublicPopulated(fresh);
  }

  async compraDirecta(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.APROBADA]);
    if (String(doc.creadaPor) === String(actor.userId)) {
      throw new ApiError(403, 'El creador de la requisición no puede adjudicar una compra directa (separación de funciones)', 'SEPARACION_FUNCIONES');
    }
    const justificacion = trimStr(data.justificacion);
    if (justificacion.length < COMPRA_DIRECTA_MIN_JUSTIFICACION) {
      throw new ApiError(400, `La justificación debe tener al menos ${COMPRA_DIRECTA_MIN_JUSTIFICACION} caracteres`, 'JUSTIFICACION_CORTA');
    }
    const c = await loadProveedorCatalogo(tenantId, data.proveedorId);
    const cid = oidOf(c._id);
    const existing = proveedoresOf(doc).find((p) => sid(p.proveedorId) === sid(cid) && isActivo(p));
    const entryId = existing ? oidOf(existing._id) : new mongoose.Types.ObjectId();
    const now = new Date();
    const set = {
      'licitacion.ganadorId': entryId,
      'licitacion.compraDirecta': { proveedorId: cid, justificacion, porId: actor.userId, at: now },
    };
    const extra = { set };
    if (existing) {
      set['licitacion.proveedores.$[w].estadoEnvio'] = PE.GANADOR;
      extra.arrayFilters = [{ 'w._id': entryId }];
    } else {
      const correo = trimStr(c.Email);
      extra.push = { 'licitacion.proveedores': { $each: [{ _id: entryId, proveedorId: cid, nombre: c.Razonsocial, correoEnvio: isValidEmail(correo) ? correo : undefined, estadoEnvio: PE.GANADOR, vistasCount: 0 }] } };
    }
    let updated;
    try {
      updated = await transition(tenantId, id, {
        from: E.APROBADA,
        to: E.ADJUDICADA,
        extraFilter: {
          'licitacion.ganadorId': null,
          ...(existing ? {} : { [`licitacion.proveedores.${LICITACION_MAX_PROVEEDORES - 1}`]: { $exists: false } }),
        },
        events: [buildTimelineEvent({
          tipo: EV.COMPRA_DIRECTA_JUSTIFICADA, actorId: actor.userId, estadoAnterior: E.APROBADA, estadoNuevo: E.ADJUDICADA, fecha: now, observacion: justificacion,
          datos: { paId: sid(entryId), proveedorId: sid(cid), nombre: c.Razonsocial },
        })],
        ...extra,
      });
    } catch (err) {
      if (err.code === 'CONFLICTO_CONCURRENTE') throw ALREADY();
      throw err;
    }
    const fresh = updated.toObject();
    await this.deps.sync(tenantId, fresh, { actorId: actor.userId });
    this.deps.notify(tenantId, 'requisicion.winner.selected', fresh, { actorId: actor.userId, actorName: actor.name, proveedorNombre: c.Razonsocial });
    await this._avisarGanador(tenantId, fresh, c.Razonsocial, c.Email);
    return toPublicPopulated(fresh);
  }

  /** Award e-mail to the winner by the external channel; a failure is logged and never breaks the award. */
  async _avisarGanador(tenantId, doc, nombre, correo) {
    try {
      if (!isValidEmail(correo)) return;
      const tenant = await Tenant.findOne({ tenantId }).select('name').lean();
      await this.deps.email.sendRequisicionAwardEmail({ to: correo, proveedorNombre: nombre, tenantName: tenant?.name, consecutivo: doc.consecutivo, titulo: doc.titulo });
    } catch (err) {
      logger.warn('requisicion award e-mail failed (ignored)', { tenantId, requisicionId: sid(doc._id), err: String(err) });
    }
  }
}

export const requisicionGanadorService = new RequisicionGanadorService();
