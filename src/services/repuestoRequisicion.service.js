import mongoose from 'mongoose';
import { Repuestos } from '../models/repuestos.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { normalizeCapabilities } from '../config/tenantCapabilities.config.js';
import { assertCapabilityOn, getTenantCapabilities } from '../utils/tenantModules.util.js';
import { requisicionService } from './requisicion.service.js';
import { syncRequisicionSolicitudesSafe, traceSolicitud, healStaleLinks } from './requisicionSolicitudSync.service.js';
import { REPUESTO_DISPONIBILIDAD as D } from '../constants/requisicion.constants.js';

/**
 * Creates a requisition from spare-part requests (change: requisiciones-e2-solicitudes-recepcion, design decision 11).
 *
 * Concurrency: the solicitudes are CLAIMED first with one conditional `updateMany` (`requisicion.requisicionId` must be
 * absent), stamping the id the requisition is about to get; two requisitions racing for the same solicitud cannot both
 * win (the loser gets 409 SOLICITUD_YA_VINCULADA and releases what it claimed). Any later failure (validation of type /
 * area, line building, send) releases the claim and removes the draft, so a failed request leaves nothing behind
 * (the consecutivo may be skipped, which E1 already accepts).
 */

const ELIGIBLE_ESTADO = ['Solicitado', null]; // `$in` with null also matches a missing field
const sid = (v) => (v === null || v === undefined ? '' : String(v));
const MAX_DESCRIPCION = 300;
const MAX_ESPECIFICACIONES = 1000;
const MAX_TITULO = 200;

/** `Cantidad` of a solicitud is free text: a plain positive number is used as is, anything else falls back to 1. */
export function parseCantidad(raw) {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (text !== '' && /^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) return { value: n, defaulted: false };
  }
  return { value: 1, defaulted: true };
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function buildDescripcion(sol, equipo) {
  const base = String(sol.nombre || '').trim();
  if (!equipo) return clip(base, MAX_DESCRIPCION);
  const eq = [equipo.item, equipo.Marca, equipo.Modelo].filter(Boolean).join(' ').trim();
  const serie = equipo.Serie ? ` S/N ${equipo.Serie}` : '';
  const info = `${eq}${serie}`.trim();
  return clip(info ? `${base} — ${info}` : base, MAX_DESCRIPCION);
}

function defaultTitulo(solicitudes) {
  const first = String(solicitudes[0]?.nombre || 'repuestos').trim();
  const more = solicitudes.length > 1 ? ` y ${solicitudes.length - 1} más` : '';
  return clip(`Repuestos: ${first}${more}`, MAX_TITULO);
}

export class RepuestoRequisicionService {
  /**
   * @param {string} tenantId
   * @param {{ userId: string, name?: string, canManageAll?: boolean }} actor
   * @param {{ repuestoIds: string[], titulo?: string, tipoRequisicionId: string, areaId: string, prioridad?: string,
   *           fechaRequerida?: string|null, justificacion?: string, lineas?: object[], enviar?: boolean }} data
   * @param {object} capabilities  `req.tenant.capabilities`
   * @returns {Promise<{ requisicion: object, advertencias: object[] }>}
   */
  async createFromSolicitudes(tenantId, actor, data, capabilities) {
    requireTenant(tenantId);
    await assertCapabilityOn(tenantId, 'usesRequisiciones', capabilities, 'Tu organización no tiene habilitado el módulo de Requisiciones.');
    const caps = capabilities ? normalizeCapabilities(capabilities) : await getTenantCapabilities(tenantId);
    const ids = [...new Set((data.repuestoIds || []).map(sid))];
    if (ids.length === 0) throw new ApiError(400, 'Debe enviar al menos una solicitud de repuesto', 'VALIDATION_ERROR');

    const overrides = new Map();
    for (const l of data.lineas || []) {
      const key = sid(l.repuestoId);
      if (!ids.includes(key)) {
        throw new ApiError(400, 'Una línea hace referencia a una solicitud que no está en la selección', 'LINEA_FUERA_DE_SELECCION', { repuestoId: key });
      }
      if (overrides.has(key)) throw new ApiError(400, 'Línea repetida para la misma solicitud', 'LINEA_FUERA_DE_SELECCION', { repuestoId: key });
      overrides.set(key, l);
    }
    const justificacion = typeof data.justificacion === 'string' ? data.justificacion.trim() : '';
    // "Crear y enviar" must not leave a draft behind when the send would be refused for this reason.
    if (data.enviar && !justificacion) {
      throw new ApiError(400, 'La justificación es obligatoria para enviar', 'JUSTIFICACION_REQUERIDA');
    }

    const solicitudes = await this._loadEligible(tenantId, ids);
    const { lineas, advertencias } = await this._buildLineas(tenantId, solicitudes, overrides, caps.usesInventoryBasic);

    // Claim: atomic per solicitud. The id is generated now so the requisition is created WITH it.
    const requisicionId = new mongoose.Types.ObjectId();
    const claim = await Repuestos.updateMany(
      {
        _id: { $in: ids },
        tenantId,
        isDeleted: false,
        EstadoSolicitud: { $in: ELIGIBLE_ESTADO },
        'requisicion.requisicionId': { $exists: false },
      },
      { $set: { requisicion: { requisicionId, disponibilidad: D.EN_REQUISICION } } },
    );
    if (claim.modifiedCount !== ids.length) {
      await this._release(tenantId, requisicionId);
      const taken = await Repuestos.find(applyTenantFilter({ _id: { $in: ids }, 'requisicion.requisicionId': { $exists: true } }, tenantId)).select('_id').lean();
      throw new ApiError(409, 'Una o más solicitudes ya tienen una requisición', 'SOLICITUD_YA_VINCULADA', {
        ids: taken.length ? taken.map((r) => sid(r._id)) : ids,
      });
    }

    let created;
    try {
      created = await requisicionService.create(
        tenantId,
        actor.userId,
        {
          titulo: (data.titulo || '').trim() || defaultTitulo(solicitudes),
          tipoRequisicionId: data.tipoRequisicionId,
          areaId: data.areaId,
          prioridad: data.prioridad,
          fechaRequerida: data.fechaRequerida ?? null,
          justificacion,
          lineas,
        },
        capabilities,
        { allowOrigen: true, id: requisicionId },
      );
    } catch (err) {
      await this._release(tenantId, requisicionId);
      throw err;
    }

    // Fill the denormalized summary (lineaId, consecutivo) of every claimed solicitud and leave a trace.
    await syncRequisicionSolicitudesSafe(tenantId, created, { actorId: actor.userId });
    for (const sol of solicitudes) {
      await traceSolicitud(tenantId, sol, created.consecutivo, 'incluida en la requisición (borrador)');
    }

    if (data.enviar) {
      try {
        await requisicionService.enviar(tenantId, sid(created._id), { userId: actor.userId, name: actor.name, canManageAll: actor.canManageAll }, {});
      } catch (err) {
        // Nothing may remain from a failed "create and send": soft-delete the draft (its sync releases the solicitudes).
        try {
          await requisicionService.delete(tenantId, sid(created._id), { userId: actor.userId, canManageAll: true });
        } catch (cleanupErr) {
          logger.error('createFromSolicitudes: cleanup of the draft failed', { tenantId, requisicionId: sid(created._id), err: String(cleanupErr) });
          await this._release(tenantId, requisicionId);
        }
        throw err;
      }
    }

    const requisicion = await requisicionService.getById(tenantId, sid(created._id));
    logger.info('Requisicion creada desde solicitudes: ' + sid(created._id));
    return { requisicion, advertencias };
  }

  async _release(tenantId, requisicionId) {
    try {
      await Repuestos.updateMany({ tenantId, 'requisicion.requisicionId': requisicionId }, { $unset: { requisicion: 1 } });
    } catch (err) {
      logger.error('createFromSolicitudes: could not release the claimed solicitudes', { tenantId, requisicionId: sid(requisicionId), err: String(err) });
    }
  }

  /**
   * Existing, tenant-scoped, non-deleted solicitudes in `Solicitado`, with no requisition.
   *  - missing / foreign tenant / deleted -> 404 SOLICITUD_NOT_FOUND
   *  - not `Solicitado`                   -> 400 SOLICITUD_NO_ELEGIBLE
   *  - already linked                     -> 409 SOLICITUD_YA_VINCULADA (details.ids)
   * Returned in the order of `ids`.
   */
  async _loadEligible(tenantId, ids) {
    const rows = await Repuestos.find(applyTenantFilter({ _id: { $in: ids } }, tenantId)).lean();
    const byId = new Map(rows.map((r) => [sid(r._id), r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new ApiError(404, 'Una o más solicitudes no existen', 'SOLICITUD_NOT_FOUND', { ids: missing });
    const ordered = ids.map((id) => byId.get(id));
    const notEligible = ordered.filter((r) => (r.EstadoSolicitud || 'Solicitado') !== 'Solicitado');
    if (notEligible.length > 0) {
      throw new ApiError(400, 'Solo se pueden incluir solicitudes en estado Solicitado', 'SOLICITUD_NO_ELEGIBLE', { ids: notEligible.map((r) => sid(r._id)) });
    }
    // A link to a requisition that is gone / deleted / Cancelada / Rechazada is stale: release it (self-heal).
    await healStaleLinks(tenantId, ordered);
    const linked = ordered.filter((r) => r.requisicion && r.requisicion.requisicionId);
    if (linked.length > 0) {
      throw new ApiError(409, 'Una o más solicitudes ya tienen una requisición', 'SOLICITUD_YA_VINCULADA', { ids: linked.map((r) => sid(r._id)) });
    }
    return ordered;
  }

  /** One requisition line per solicitud (quantity, price and description as per design decision 11). */
  async _buildLineas(tenantId, solicitudes, overrides, usesInventoryBasic) {
    const advertencias = [];
    const equipoIds = [...new Set(solicitudes.map((s) => sid(s.EquipoId)).filter(Boolean))];
    const equipos = equipoIds.length
      ? await EquipoItem.find(applyTenantFilter({ _id: { $in: equipoIds } }, tenantId)).select('item Marca Modelo Serie Inventario').lean()
      : [];
    const equipoById = new Map(equipos.map((e) => [sid(e._id), e]));

    const itemIds = usesInventoryBasic
      ? [...new Set(solicitudes.map((s) => sid(s.InventarioItemId)).filter(Boolean))]
      : [];
    const items = itemIds.length
      ? await InventarioRepuesto.find(applyTenantFilter({ _id: { $in: itemIds } }, tenantId)).select('_id nombre unidad precio').lean()
      : [];
    const itemById = new Map(items.map((i) => [sid(i._id), i]));

    const lineas = solicitudes.map((sol) => {
      const key = sid(sol._id);
      const o = overrides.get(key) || {};

      let cantidad;
      if (o.cantidad !== undefined && o.cantidad !== null) {
        cantidad = Number(o.cantidad);
      } else {
        const parsed = parseCantidad(sol.Cantidad);
        cantidad = parsed.value;
        if (parsed.defaulted) {
          advertencias.push({
            repuestoId: key,
            campo: 'cantidad',
            valorOriginal: sol.Cantidad ?? null,
            mensaje: `La cantidad "${sol.Cantidad ?? ''}" de "${sol.nombre}" no es numérica; se usó 1. Corrígela antes de enviar.`,
          });
        }
      }

      // Several solicitudes may share a stock item: each line keeps its inventarioItemId (the stock movement and the
      // marker apply per line), so the OT never discounts goods that were bought and never entered.
      const itemKey = usesInventoryBasic ? sid(sol.InventarioItemId) : '';
      const item = itemKey ? itemById.get(itemKey) : null;

      let precio;
      if (o.precioEstimado !== undefined && o.precioEstimado !== null) precio = Number(o.precioEstimado);
      else if (Number(sol.PrecioRepuesto) > 0) precio = Number(sol.PrecioRepuesto);
      else precio = Number(item?.precio) || 0;

      const descripcion = (o.descripcion && String(o.descripcion).trim()) || buildDescripcion(sol, equipoById.get(sid(sol.EquipoId)));
      const linea = {
        descripcion: clip(descripcion, MAX_DESCRIPCION),
        unidad: item?.unidad || 'und',
        cantidadSolicitada: cantidad,
        precioEstimado: precio,
        inventarioItemId: item ? sid(item._id) : null,
        origenSolicitudRepuestoId: sol._id,
        // Snapshot: who confirms the delivery is fixed now, later edits of the solicitud cannot change it.
        responsableId: sol.ResponsableSolicitud || null,
      };
      if (sol.observacion) linea.especificaciones = clip(String(sol.observacion), MAX_ESPECIFICACIONES);
      return linea;
    });
    return { lineas, advertencias };
  }
}

export const repuestoRequisicionService = new RepuestoRequisicionService();

