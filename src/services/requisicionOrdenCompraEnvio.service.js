import { Requisicion, buildTimelineEvent } from '../models/requisicion.model.js';
import { Tenant } from '../models/tenant.model.js';
import { Customer } from '../models/customer.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { env } from '../config/env.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { toPublicPopulated } from '../utils/requisicionPublic.util.js';
import { generateProveedorToken, buildPortalLink } from '../utils/requisicionToken.util.js';
import { emailService } from './external/email.service.js';
import { transition } from './requisicionTransition.service.js';
import { notifyRequisicion } from './requisicionNotify.service.js';
import {
  OC_CORREO_ESTADO,
  OC_ESTADO,
  REQUISICION_ESTADO as E,
  REQUISICION_EVENTO as EV,
  REQUISICION_TIMEZONE,
} from '../constants/requisicion.constants.js';
import { assertEstado, assertModule, isValidEmail, loadRequisicion, oidOf, proveedoresOf, sid, trimStr } from './requisicionLicitacion.shared.js';

/**
 * Sending the purchase order to the winner (change: requisiciones-e4-oc-recepcion, task 1.6).
 *  - `enviar`: `OC_Aprobada -> OC_Enviada` in ONE conditional write that also mints the winner's personal link (only the
 *    SHA-256 hash is stored; the link does not expire while the requisition is open, see the close in the reception
 *    service). The e-mail goes out AFTER, with `allSettled`; its result is kept in `ordenCompra.envio.estadoCorreo` and a
 *    failure never rolls the state back.
 *  - `reenviar`: sends a fresh link; the stored hash only rotates when the e-mail really went out (else the old link
 *    keeps working), compare-and-set on the hash read before sending.
 */

/** `ab***@dominio.com`: the timeline keeps no full address of the supplier. */
export function maskEmail(email) {
  const [user = '', domain = ''] = String(email || '').split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString('es-CO', { timeZone: REQUISICION_TIMEZONE, dateStyle: 'long' }) : '');

export class RequisicionOrdenCompraEnvioService {
  // Seam for tests (ESM bindings are immutable).
  deps = { email: emailService, notify: notifyRequisicion, envio: env };

  /** Fail fast (before any write) when the link could not really reach the supplier. */
  _assertEnvioDisponible() {
    const e = this.deps.envio;
    if (!e.NOTIFICATIONS_ENABLED) {
      throw new ApiError(409, 'El envío de correos está desactivado en este entorno; no se puede enviar la orden de compra', 'NOTIFICACIONES_DESACTIVADAS');
    }
    if (e.NODE_ENV === 'production' && (!e.PUBLIC_APP_URL || /localhost|127\.0\.0\.1/i.test(e.PUBLIC_APP_URL))) {
      throw new ApiError(409, 'La URL pública de la aplicación no está configurada; el enlace del proveedor sería inválido', 'PUBLIC_APP_URL_NO_CONFIGURADA');
    }
  }

  _winnerEntry(doc) {
    const entry = proveedoresOf(doc).find((p) => sid(p._id) === sid(doc.licitacion?.ganadorId));
    if (!entry) throw new ApiError(409, 'La requisición no tiene un proveedor ganador', 'SIN_GANADOR');
    return entry;
  }

  /** Address of the winner: its tender entry, else the catalogue record (tenant scoped). */
  async _winnerEmail(tenantId, entry, override = '') {
    const first = trimStr(override) || trimStr(entry.correoEnvio);
    if (isValidEmail(first)) return first.toLowerCase();
    if (!entry.proveedorId) return '';
    const c = await Customer.findOne(applyTenantFilter({ _id: entry.proveedorId, kind: 'provider' }, tenantId)).select('Email').lean();
    return isValidEmail(trimStr(c?.Email)) ? trimStr(c.Email).toLowerCase() : '';
  }

  /** One individual e-mail (`allSettled`): returns the stored mailing state. Never throws. */
  async _enviarCorreo(tenantId, doc, entry, to, token) {
    if (!to) return OC_CORREO_ESTADO.SIN_CORREO;
    const tenant = await Tenant.findOne({ tenantId }).select('name').lean();
    const oc = doc.ordenCompra;
    const [r] = await Promise.allSettled([this.deps.email.sendRequisicionOrdenCompraEmail({
      to,
      proveedorNombre: entry.nombre,
      tenantName: tenant?.name,
      consecutivo: doc.consecutivo,
      titulo: doc.titulo,
      ocNumero: oc.numero,
      fechaEntrega: fmtFecha(oc.fechaEntrega),
      requiereEntregables: Boolean(oc.requiereEntregables),
      portalUrl: buildPortalLink(token),
    })]);
    if (r.status === 'fulfilled' && r.value?.sent) return OC_CORREO_ESTADO.ENVIADO;
    const skipped = r.status === 'fulfilled' && r.value?.skipped;
    logger.warn('requisicion OC e-mail not sent', { tenantId, requisicionId: sid(doc._id), motivo: skipped ? 'desactivado' : 'fallido' });
    return skipped ? OC_CORREO_ESTADO.DESACTIVADO : OC_CORREO_ESTADO.FALLIDO;
  }

  /** Stores the mailing result (leaf write of the OC block; never touches the state). */
  async _guardarEstadoCorreo(tenantId, id, estado, estados = [E.OC_ENVIADA]) {
    try {
      await Requisicion.updateOne(
        { _id: id, tenantId, isDeleted: false, estado: { $in: estados } },
        { $set: { 'ordenCompra.envio.estadoCorreo': estado } },
        { timestamps: false },
      );
    } catch (err) {
      logger.warn('requisicion OC: mailing state not stored', { tenantId, requisicionId: sid(id), err: String(err) });
    }
  }

  async enviar(tenantId, id, actor, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    this._assertEnvioDisponible();
    const doc = await loadRequisicion(tenantId, id);
    if (!doc.ordenCompra?.numero) throw new ApiError(404, 'La requisición no tiene orden de compra', 'ORDEN_COMPRA_NOT_FOUND');
    assertEstado(doc, [E.OC_APROBADA]);
    const entry = this._winnerEntry(doc);
    const to = await this._winnerEmail(tenantId, entry);
    const t = generateProveedorToken();
    const wid = oidOf(entry._id);
    const now = new Date();
    let updated;
    try {
      updated = await transition(tenantId, id, {
        from: E.OC_APROBADA,
        to: E.OC_ENVIADA,
        extraFilter: {
          'ordenCompra.version': doc.ordenCompra.version,
          'licitacion.ganadorId': wid,
        },
        events: [buildTimelineEvent({
          tipo: EV.OC_ENVIADA, actorId: actor.userId, estadoAnterior: E.OC_APROBADA, estadoNuevo: E.OC_ENVIADA, fecha: now,
          datos: { numero: doc.ordenCompra.numero, version: doc.ordenCompra.version, total: doc.ordenCompra.total, paId: sid(wid), nombre: entry.nombre },
        })],
        set: {
          'ordenCompra.estado': OC_ESTADO.ENVIADA,
          'ordenCompra.envio.enviadaEn': now,
          // The hash only rotates when a mail will actually be attempted (else the E3 link keeps working).
          ...(to ? {
            'licitacion.proveedores.$[w].tokenHash': t.tokenHash,
            'licitacion.proveedores.$[w].tokenHint': t.tokenHint,
            // The winner's link stays usable while the requisition is open (the close sets the post-close deadline).
            'licitacion.proveedores.$[w].tokenVence': null,
            'licitacion.proveedores.$[w].correoEnvio': to,
          } : {}),
        },
        ...(to ? { arrayFilters: [{ 'w._id': wid }] } : {}),
      });
    } catch (err) {
      if (err.code === 'CONFLICTO_CONCURRENTE') throw new ApiError(409, 'La orden de compra cambió mientras se enviaba; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
      throw err;
    }
    const estadoCorreo = await this._enviarCorreo(tenantId, updated.toObject(), entry, to, t.token);
    await this._guardarEstadoCorreo(tenantId, id, estadoCorreo);
    const fresh = await loadRequisicion(tenantId, id);
    this.deps.notify(tenantId, 'requisicion.po.sent', fresh, { actorId: actor.userId, actorName: actor.name, ocNumero: fresh.ordenCompra.numero });
    return toPublicPopulated(fresh);
  }

  async reenviar(tenantId, id, actor, data = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    this._assertEnvioDisponible();
    const doc = await loadRequisicion(tenantId, id);
    if (!doc.ordenCompra?.numero) throw new ApiError(404, 'La requisición no tiene orden de compra', 'ORDEN_COMPRA_NOT_FOUND');
    // Still resendable while the goods are being received (the return cycle of the deliverables needs the portal link).
    assertEstado(doc, [E.OC_ENVIADA, E.EN_RECEPCION]);
    const entry = this._winnerEntry(doc);
    const override = trimStr(data.correoEnvio);
    const onFile = await this._winnerEmail(tenantId, entry);
    if (override) {
      // An address typed by the user is only accepted when the winner has none on file (otherwise anybody with issue-po
      // could mail the price-bearing link anywhere), and only for issue-po / manage-all holders.
      if (onFile || doc.ordenCompra.envio?.estadoCorreo !== OC_CORREO_ESTADO.SIN_CORREO || !(actor.canIssuePo || actor.canManageAll)) {
        throw new ApiError(403, 'No puedes indicar otro correo: el proveedor ya tiene uno registrado', 'CORREO_NO_PERMITIDO');
      }
      if (!isValidEmail(override)) throw new ApiError(400, 'El correo indicado no es válido', 'CORREO_INVALIDO');
    }
    const to = override ? override.toLowerCase() : onFile;
    if (!to) throw new ApiError(400, 'El proveedor ganador no tiene un correo válido', 'CORREO_INVALIDO');
    const wid = oidOf(entry._id);
    const raw = await Requisicion.collection.findOne({ _id: oidOf(id), tenantId, isDeleted: { $ne: true } },
      { projection: { estado: 1, 'licitacion.proveedores._id': 1, 'licitacion.proveedores.tokenHash': 1 } });
    const hash0 = (raw?.licitacion?.proveedores || []).find((x) => sid(x._id) === sid(wid))?.tokenHash;
    if (!raw || ![E.OC_ENVIADA, E.EN_RECEPCION].includes(raw.estado)) throw new ApiError(409, 'La orden de compra cambió mientras se procesaba la operación; recarga e intenta de nuevo', 'CONFLICTO_CONCURRENTE');
    const t = generateProveedorToken();
    // Compare-and-set BEFORE sending: the stored hash read above must still be the stored one. A lost race fails here, so
    // an e-mail with a link that was never stored (dead link) is never sent.
    const updated = await Requisicion.appendEvent(
      {
        _id: id,
        tenantId,
        estado: { $in: [E.OC_ENVIADA, E.EN_RECEPCION] },
        'licitacion.proveedores': { $elemMatch: { _id: wid, ...(hash0 ? { tokenHash: hash0 } : {}) } },
      },
      buildTimelineEvent({
        tipo: EV.OC_REENVIADA, actorId: actor.userId, estadoAnterior: doc.estado, estadoNuevo: doc.estado,
        datos: { numero: doc.ordenCompra.numero, version: doc.ordenCompra.version, paId: sid(wid), nombre: entry.nombre, destinatario: maskEmail(to) },
      }),
      {
        set: {
          'licitacion.proveedores.$[w].tokenHash': t.tokenHash,
          'licitacion.proveedores.$[w].tokenHint': t.tokenHint,
          'licitacion.proveedores.$[w].correoEnvio': to,
        },
        arrayFilters: [{ 'w._id': wid }],
      },
    );
    if (!updated) throw new ApiError(409, 'La orden de compra cambió mientras se reenviaba; vuelve a intentarlo', 'CONFLICTO_CONCURRENTE');
    const estadoCorreo = await this._enviarCorreo(tenantId, doc, entry, to, t.token);
    await this._guardarEstadoCorreo(tenantId, id, estadoCorreo, [E.OC_ENVIADA, E.EN_RECEPCION]);
    return toPublicPopulated(await loadRequisicion(tenantId, id));
  }
}

export const requisicionOrdenCompraEnvioService = new RequisicionOrdenCompraEnvioService();
