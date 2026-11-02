import mongoose from 'mongoose';
import { Requisicion, buildTimelineEvent } from '../models/requisicion.model.js';
import { Tenant } from '../models/tenant.model.js';
import { Customer } from '../models/customer.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { env } from '../config/env.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { generateProveedorToken, buildPortalLink } from '../utils/requisicionToken.util.js';
import { emailService } from './external/email.service.js';
import { transition } from './requisicionTransition.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import { requisicionLicitacionCotizacionService } from './requisicionLicitacionCotizacion.service.js';
import {
  LICITACION_MAX_DIAS_LIMITE,
  LICITACION_MAX_PROVEEDORES,
  LICITACION_MIN_PROVEEDORES,
  PROVEEDOR_ESTADO_ENVIO as PE,
  PROVEEDOR_ESTADOS_ACTIVOS,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
  REQUISICION_TIMEZONE,
} from '../constants/requisicion.constants.js';
import {
  assertEstado, assertModule, findProveedor, isActivo, isValidEmail, loadProveedorCatalogo, loadRequisicion, oidOf, plain, proveedoresOf, sid, trimStr,
} from './requisicionLicitacion.shared.js';

/**
 * Tendering (licitacion) management: assign / remove suppliers, open the tender and e-mail the invitations, resend with
 * a rotated token (change: requisiciones-e3-compras-portal, group 2). Every write is ONE conditional write through
 * `Requisicion.appendEvent` / `transition`; e-mails go out AFTER the state write with `Promise.allSettled` and a failure
 * never rolls anything back (the supplier stays `Pendiente` and can be resent). Tokens are never stored in clear.
 */

const MAX_ATTEMPTS = 3;
export const MOTIVO_ENVIO = Object.freeze({ DESACTIVADO: 'NOTIFICACIONES_DESACTIVADAS', FALLIDO: 'ENVIO_FALLIDO', CORREO: 'CORREO_INVALIDO' });

/** Deadline: a valid FUTURE date, at most 90 days ahead. */
export function validateFechaLimite(value, now = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new ApiError(400, 'La fecha límite de cotización es obligatoria y debe ser una fecha válida', 'FECHA_LIMITE_INVALIDA');
  if (d.getTime() <= now.getTime()) throw new ApiError(400, 'La fecha límite de cotización debe ser futura', 'FECHA_LIMITE_INVALIDA');
  if (d.getTime() > now.getTime() + LICITACION_MAX_DIAS_LIMITE * 86400000) {
    throw new ApiError(400, `La fecha límite no puede superar ${LICITACION_MAX_DIAS_LIMITE} días`, 'FECHA_LIMITE_INVALIDA');
  }
  return d;
}

const fmtFecha = (d) => new Date(d).toLocaleString('es-CO', { timeZone: REQUISICION_TIMEZONE, dateStyle: 'long', timeStyle: 'short' });

export class RequisicionLicitacionService {
  // Seam for tests (ESM bindings are immutable).
  deps = { email: emailService, notify: notifyRequisicion, envio: env };

  /** Fail fast (before any write) when invitations cannot really reach the suppliers. */
  _assertEnvioDisponible() {
    const e = this.deps.envio;
    if (!e.NOTIFICATIONS_ENABLED) {
      throw new ApiError(409, 'El envío de correos está desactivado en este entorno; no se pueden enviar invitaciones', 'NOTIFICACIONES_DESACTIVADAS');
    }
    if (e.NODE_ENV === 'production' && (!e.PUBLIC_APP_URL || /localhost|127\.0\.0\.1/i.test(e.PUBLIC_APP_URL))) {
      throw new ApiError(409, 'La URL pública de la aplicación no está configurada; los enlaces de los proveedores serían inválidos', 'PUBLIC_APP_URL_NO_CONFIGURADA');
    }
  }

  // ------------------------------------------------------------------------------------------ suppliers

  async asignarProveedor(tenantId, id, actor, data, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.APROBADA, E.EN_LICITACION]);
    const c = await loadProveedorCatalogo(tenantId, data.proveedorId);
    const correo = trimStr(data.correoEnvio) || trimStr(c.Email);
    if (data.correoEnvio !== undefined && trimStr(data.correoEnvio) && !isValidEmail(correo)) throw new ApiError(400, 'El correo de envío no es válido', 'CORREO_INVALIDO');
    const { tokenHash, tokenHint } = generateProveedorToken(); // placeholder: the real link is minted when the invitation is sent
    const cid = oidOf(c._id);
    const entry = {
      _id: new mongoose.Types.ObjectId(), proveedorId: cid, nombre: c.Razonsocial, correoEnvio: correo || undefined,
      tokenHash, tokenHint, tokenVence: null, estadoEnvio: PE.PENDIENTE, vistasCount: 0,
    };
    const updated = await Requisicion.appendEvent(
      {
        _id: id,
        tenantId,
        estado: { $in: [E.APROBADA, E.EN_LICITACION] },
        'licitacion.proveedores': { $not: { $elemMatch: { proveedorId: cid, estadoEnvio: { $in: PROVEEDOR_ESTADOS_ACTIVOS } } } },
        [`licitacion.proveedores.${LICITACION_MAX_PROVEEDORES - 1}`]: { $exists: false },
      },
      buildTimelineEvent({ tipo: EV.PROVEEDOR_ASIGNADO, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: doc.estado, datos: { paId: sid(entry._id), proveedorId: sid(cid), nombre: c.Razonsocial } }),
      { push: { 'licitacion.proveedores': { $each: [entry] } } },
    );
    if (updated) return toPublicPopulated(updated);
    const fresh = await loadRequisicion(tenantId, id);
    assertEstado(fresh, [E.APROBADA, E.EN_LICITACION]);
    const list = proveedoresOf(fresh);
    if (list.some((p) => sid(p.proveedorId) === sid(cid) && isActivo(p))) throw new ApiError(409, 'El proveedor ya está asignado a la requisición', 'PROVEEDOR_DUPLICADO');
    if (list.length >= LICITACION_MAX_PROVEEDORES) throw new ApiError(400, `Máximo ${LICITACION_MAX_PROVEEDORES} proveedores por requisición`, 'LIMITE_PROVEEDORES');
    throw new ApiError(409, 'La requisición cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
  }

  /** Before the tender opens the entry is removed; once open it is marked `Descartado` and its link expires. */
  async quitarProveedor(tenantId, id, paId, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.APROBADA, E.EN_LICITACION]);
    const p = findProveedor(doc, paId);
    const pid = oidOf(p._id);
    if (p.cotizacion) throw new ApiError(409, 'No se puede quitar un proveedor que ya cotizó', 'PROVEEDOR_CON_COTIZACION');
    if (!isActivo(p)) throw new ApiError(409, 'El proveedor ya no está activo en la licitación', 'PROVEEDOR_INACTIVO');
    const abierta = doc.estado === E.EN_LICITACION;
    const guard = { 'licitacion.proveedores': { $elemMatch: { _id: pid, estadoEnvio: p.estadoEnvio, cotizacion: { $exists: false } } } };
    const event = buildTimelineEvent({ tipo: EV.PROVEEDOR_QUITADO, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: doc.estado, datos: { paId: sid(pid), nombre: p.nombre } });
    const updated = await Requisicion.appendEvent(
      { _id: id, tenantId, estado: doc.estado, ...guard },
      event,
      abierta
        ? { set: { 'licitacion.proveedores.$[p].estadoEnvio': PE.DESCARTADO, 'licitacion.proveedores.$[p].tokenVence': new Date() }, arrayFilters: [{ 'p._id': pid }] }
        : { pull: { 'licitacion.proveedores': { _id: pid } } },
    );
    if (!updated) throw new ApiError(409, 'La requisición cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
    if (abierta) await requisicionLicitacionCotizacionService.maybeAutoClose(tenantId, id, { userId: null });
    return toPublicPopulated(await loadRequisicion(tenantId, id));
  }

  // ------------------------------------------------------------------------------------------ open the tender

  async abrir(tenantId, id, actor, data, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    this._assertEnvioDisponible();
    const fecha = validateFechaLimite(data?.fechaLimiteCotizacion);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const doc = await loadRequisicion(tenantId, id);
      assertEstado(doc, [E.APROBADA]);
      let sendables = proveedoresOf(doc).filter((p) => isActivo(p) && isValidEmail(p.correoEnvio));
      if (sendables.length >= LICITACION_MIN_PROVEEDORES) {
        // a catalogue provider deleted (or no longer a provider) after being assigned is not invited
        const live = new Set((await Customer.find({ _id: { $in: sendables.map((p) => p.proveedorId) }, tenantId, kind: 'provider' }).select('_id').lean()).map((c) => sid(c._id)));
        sendables = sendables.filter((p) => live.has(sid(p.proveedorId)));
      }
      if (sendables.length < LICITACION_MIN_PROVEEDORES) {
        throw new ApiError(400, `Se necesitan al menos ${LICITACION_MIN_PROVEEDORES} proveedores activos con un correo válido para abrir la licitación`, 'PROVEEDORES_INSUFICIENTES');
      }
      const now = new Date();
      const instrucciones = trimStr(data?.instrucciones).slice(0, 500);
      const set = { 'licitacion.fechaLimiteCotizacion': fecha, 'licitacion.abiertaAt': now, ...(instrucciones ? { 'licitacion.instrucciones': instrucciones } : {}) };
      const arrayFilters = [];
      const targets = sendables.map((p, i) => {
        const t = generateProveedorToken();
        set[`licitacion.proveedores.$[t${i}].tokenHash`] = t.tokenHash;
        set[`licitacion.proveedores.$[t${i}].tokenHint`] = t.tokenHint;
        set[`licitacion.proveedores.$[t${i}].tokenVence`] = fecha;
        arrayFilters.push({ [`t${i}._id`]: oidOf(p._id) });
        return { p, token: t.token };
      });
      let updated;
      try {
        updated = await transition(tenantId, id, {
          from: E.APROBADA,
          to: E.EN_LICITACION,
          extraFilter: { 'licitacion.proveedores': { $size: proveedoresOf(doc).length } },
          events: [buildTimelineEvent({
            tipo: EV.LICITACION_INICIADA, actorId: actor.userId, estadoAnterior: E.APROBADA, estadoNuevo: E.EN_LICITACION, fecha: now,
            datos: { proveedores: sendables.length, fechaLimiteCotizacion: fecha.toISOString() },
          })],
          set,
          arrayFilters,
        });
      } catch (err) {
        if (err.code === 'CONFLICTO_CONCURRENTE') continue;
        throw err;
      }
      const envios = await this._enviar(tenantId, plain(updated), targets);
      const final = await this._marcarEnviados(tenantId, id, actor, targets, envios);
      this.deps.notify(tenantId, 'requisicion.rfq.sent', final || plain(updated), { actorId: actor.userId, actorName: actor.name, enviados: envios.enviados.length, fallidos: envios.fallidos.length });
      return { ...(await toPublicPopulated(final || updated)), envios };
    }
    throw new ApiError(409, 'La requisición cambió mientras se abría la licitación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
  }

  // ------------------------------------------------------------------------------------------ extend the deadline

  /**
   * Extends the quotation deadline of an OPEN tender (new date: later than the current one, future, <= 90 days from now).
   * The links of the active suppliers that were not closed early follow the new deadline, so they can answer / be resent.
   */
  async ampliarFechaLimite(tenantId, id, actor, data, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const nueva = validateFechaLimite(data?.fechaLimiteCotizacion);
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.EN_LICITACION]);
    const actual = doc.licitacion?.fechaLimiteCotizacion ? new Date(doc.licitacion.fechaLimiteCotizacion) : null;
    if (actual && nueva.getTime() <= actual.getTime()) throw new ApiError(400, 'La nueva fecha límite debe ser posterior a la actual', 'FECHA_LIMITE_INVALIDA');
    const updated = await Requisicion.appendEvent(
      { _id: id, tenantId, estado: E.EN_LICITACION, 'licitacion.fechaLimiteCotizacion': actual },
      buildTimelineEvent({
        tipo: EV.FECHA_LIMITE_AMPLIADA, actorId: actor.userId, estadoAnterior: E.EN_LICITACION, estadoNuevo: E.EN_LICITACION,
        datos: { anterior: actual ? actual.toISOString() : null, nueva: nueva.toISOString() },
      }),
      {
        set: { 'licitacion.fechaLimiteCotizacion': nueva, 'licitacion.proveedores.$[x].tokenVence': nueva },
        // active suppliers whose link was NOT closed early (its expiry still equals the old deadline)
        arrayFilters: [{ 'x.estadoEnvio': { $in: PROVEEDOR_ESTADOS_ACTIVOS }, 'x.tokenVence': actual ? { $gte: actual } : { $exists: true } }],
      },
    );
    if (!updated) throw new ApiError(409, 'La licitación cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
    return toPublicPopulated(updated);
  }

  // ------------------------------------------------------------------------------------------ resend

  async reenviar(tenantId, id, paId, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    this._assertEnvioDisponible();
    const doc = await loadRequisicion(tenantId, id);
    assertEstado(doc, [E.EN_LICITACION]);
    const p = findProveedor(doc, paId);
    if (!isActivo(p)) throw new ApiError(409, 'El proveedor ya no está activo en la licitación', 'PROVEEDOR_INACTIVO');
    const fecha = doc.licitacion?.fechaLimiteCotizacion;
    if (!fecha || new Date(fecha).getTime() <= Date.now()) throw new ApiError(409, 'La fecha límite de cotización ya venció', 'FECHA_LIMITE_VENCIDA');
    const correo = trimStr(data.correoEnvio) || trimStr(p.correoEnvio);
    if (!isValidEmail(correo)) throw new ApiError(400, 'El correo de envío no es válido', 'CORREO_INVALIDO');
    const t = generateProveedorToken();
    const pid = oidOf(p._id);
    // Send FIRST with the new token; the stored hash only rotates when the e-mail went out (else the old link keeps working).
    const targets = [{ p: { ...p, correoEnvio: correo.toLowerCase() }, token: t.token }];
    // Compare-and-set: the stored hash read BEFORE sending must still be the stored one when we persist (a concurrent resend
    // that persisted first wins; this one gets 409 — its e-mail may already be out, which cannot be avoided without a lock).
    const state0 = await this._rotationState(tenantId, id, pid);
    if (!state0 || state0.estado !== E.EN_LICITACION) throw new ApiError(409, 'La requisición cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
    const envios = await this._enviar(tenantId, doc, targets);
    if (envios.enviados.length === 0) return { ...(await toPublicPopulated(doc)), envios };
    let vence = state0.fecha;
    let matched = false;
    for (let attempt = 0; attempt < 2 && !matched; attempt += 1) {
      const r = await Requisicion.updateOne(
        {
          _id: id, tenantId, isDeleted: false, estado: E.EN_LICITACION,
          'licitacion.fechaLimiteCotizacion': vence,
          'licitacion.proveedores': { $elemMatch: { _id: pid, estadoEnvio: p.estadoEnvio, tokenHash: state0.hash } },
        },
        { $set: {
          'licitacion.proveedores.$[t].tokenHash': t.tokenHash,
          'licitacion.proveedores.$[t].tokenHint': t.tokenHint,
          'licitacion.proveedores.$[t].tokenVence': vence, // always the deadline that is current at write time
          'licitacion.proveedores.$[t].correoEnvio': correo.toLowerCase(),
        } },
        { arrayFilters: [{ 't._id': pid }] },
      );
      matched = Boolean(r.matchedCount);
      if (matched) break;
      const cur = await this._rotationState(tenantId, id, pid);
      // the deadline moved (fecha-limite extension) but the stored link is still the one we read: retry once with it
      if (!cur || cur.estado !== E.EN_LICITACION || cur.hash !== state0.hash || !cur.fecha || new Date(cur.fecha).getTime() === new Date(vence).getTime()) break;
      vence = cur.fecha;
    }
    if (!matched) throw new ApiError(409, 'La requisición cambió mientras se reenviaba la invitación; vuelve a intentarlo', 'CONFLICTO_CONCURRENTE');
    const final = await this._marcarEnviados(tenantId, id, actor, targets, envios);
    return { ...(await toPublicPopulated(final || await loadRequisicion(tenantId, id))), envios };
  }

  /** Raw read (the hash is `select: false`) of what a resend must compare-and-set: state, deadline and the supplier's hash. */
  async _rotationState(tenantId, id, pid) {
    const raw = await Requisicion.collection.findOne({ _id: oidOf(id), tenantId, isDeleted: { $ne: true } },
      { projection: { estado: 1, 'licitacion.fechaLimiteCotizacion': 1, 'licitacion.proveedores._id': 1, 'licitacion.proveedores.tokenHash': 1 } });
    const entry = (raw?.licitacion?.proveedores || []).find((x) => sid(x._id) === sid(pid));
    return raw && entry ? { estado: raw.estado, fecha: raw.licitacion.fechaLimiteCotizacion, hash: entry.tokenHash } : null;
  }

  // ------------------------------------------------------------------------------------------ e-mail

  /** One individual e-mail per supplier (`allSettled`): returns who was sent and who failed (fixed reasons only). */
  async _enviar(tenantId, doc, targets) {
    const tenant = await Tenant.findOne({ tenantId }).select('name').lean();
    const items = (doc.lineas || []).filter((l) => l.estadoLinea !== 'Cancelada')
      .map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidadSolicitada, unidad: l.unidad, especificacion: l.especificaciones }));
    const fechaLimite = fmtFecha(doc.licitacion.fechaLimiteCotizacion);
    const results = await Promise.allSettled(targets.map((t) => this.deps.email.sendRequisicionRfqInvitationEmail({
      to: t.p.correoEnvio,
      proveedorNombre: t.p.nombre,
      tenantName: tenant?.name,
      consecutivo: doc.consecutivo,
      titulo: doc.titulo,
      fechaLimite,
      instrucciones: doc.licitacion.instrucciones || '',
      items,
      portalUrl: buildPortalLink(t.token),
    })));
    const envios = { enviados: [], fallidos: [] };
    results.forEach((r, i) => {
      const paId = sid(targets[i].p._id);
      if (r.status === 'fulfilled' && r.value?.sent) envios.enviados.push(paId);
      else {
        const motivo = r.status === 'fulfilled' && r.value?.skipped ? MOTIVO_ENVIO.DESACTIVADO : MOTIVO_ENVIO.FALLIDO;
        envios.fallidos.push({ paId, motivo });
        logger.warn('requisicion rfq e-mail not sent', { tenantId, requisicionId: sid(doc._id), paId, motivo });
      }
    });
    return envios;
  }

  /** Marks the sent suppliers `Enviado` (a resend keeps `Aceptado`) and records INVITACIONES_ENVIADAS. Null if nothing was sent. */
  async _marcarEnviados(tenantId, id, actor, targets, envios) {
    const sent = targets.filter((t) => envios.enviados.includes(sid(t.p._id)));
    if (sent.length === 0) return null;
    const now = new Date();
    const set = {};
    const arrayFilters = [];
    sent.forEach((t, i) => {
      set[`licitacion.proveedores.$[s${i}].fechaEnvio`] = now;
      arrayFilters.push({ [`s${i}._id`]: oidOf(t.p._id) });
      if (t.p.estadoEnvio === PE.PENDIENTE) {
        set[`licitacion.proveedores.$[s${i}].estadoEnvio`] = PE.ENVIADO;
        arrayFilters[i][`s${i}.estadoEnvio`] = PE.PENDIENTE;
      }
    });
    const updated = await Requisicion.appendEvent(
      { _id: id, tenantId, estado: E.EN_LICITACION },
      buildTimelineEvent({
        tipo: EV.INVITACIONES_ENVIADAS, actorId: actor.userId, estadoAnterior: E.EN_LICITACION, estadoNuevo: E.EN_LICITACION, fecha: now,
        datos: { enviados: sent.length, fallidos: envios.fallidos.length, proveedores: sent.map((t) => ({ paId: sid(t.p._id), nombre: t.p.nombre })) },
      }),
      { set, arrayFilters },
    );
    if (!updated) logger.warn('requisicion rfq: could not mark the invitations as sent (state changed)', { tenantId, requisicionId: String(id) });
    return updated ? plain(updated) : null;
  }
}

export const requisicionLicitacionService = new RequisicionLicitacionService();
