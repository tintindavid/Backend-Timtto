'use strict';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

import { EquipmentQr } from '../models/equipmentQr.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { env } from '../config/env.js';
import { generateQrPng, uploadQrPng, readOrRegenerateQrPngDataUri } from '../utils/qrImage.util.js';
import { MAX_BULK_SIZE, QR_TOKEN_LENGTH } from '../constants/equipmentQr.constants.js';

const QR_IMAGE_SCOPE = 'equipment-qrs';

/**
 * EquipmentQrService — admin-side CRUD + bulk generation for per-equipo
 * public QRs. Mirrors ServiceQrService's shape (serviceQr.service.js) —
 * tenantId is always the last/explicit scoping param, never trusted from
 * the DTO.
 */
export class EquipmentQrService {
  /** Build the landing URL encoded into the QR (design D7 — public route). */
  _buildLandingUrl(qrToken) {
    return `${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/public/equipo/${qrToken}`;
  }

  /**
   * Return the QR PNG as a data URI. Reads the persisted file first; if it
   * is missing (ephemeral filesystem on Railway after a redeploy, or a
   * different horizontally-scaled instance), regenerates it on the fly from
   * the deterministic landing URL. Accepts a QR doc (preferred — carries
   * `qrToken` for the fallback) or a bare id (fallback becomes a no-op).
   */
  async _readQrImageDataUri(qrOrId) {
    if (!qrOrId) return null;
    if (typeof qrOrId === 'string') {
      return readOrRegenerateQrPngDataUri(qrOrId, QR_IMAGE_SCOPE, null);
    }
    const id = String(qrOrId._id);
    const landingUrl = qrOrId.qrToken ? this._buildLandingUrl(qrOrId.qrToken) : null;
    return readOrRegenerateQrPngDataUri(id, QR_IMAGE_SCOPE, landingUrl);
  }

  /**
   * Translate the admin filter `{ ClienteId, SedeId, Servicio, EstadoOperativo, search }`
   * into an EquipoItem query, always tenant-scoped.
   */
  _buildEquipoFilter(filter = {}, tenantId) {
    const { ClienteId, SedeId, Servicio, EstadoOperativo, search } = filter;
    const query = applyTenantFilter({}, tenantId);
    if (ClienteId) query.ClienteId = ClienteId;
    if (SedeId) query.SedeId = SedeId;
    if (Servicio) query.Servicio = Servicio;
    if (EstadoOperativo) query.EstadoOperativo = EstadoOperativo;
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ Serie: rx }, { Inventario: rx }];
    }
    return query;
  }

  /**
   * Idempotent create (design D3 + D13 — check-then-insert-then-recover).
   * Returns `{ created: boolean, doc }`. The controller maps `created` to
   * HTTP 201/200.
   */
  async generateForEquipo(equipoId, tenantId, userId = null) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(equipoId)) {
      throw new ApiError(404, 'Equipo no encontrado', 'EQUIPO_NOT_FOUND', { equipoId });
    }

    const equipo = await EquipoItem.findOne(applyTenantFilter({ _id: equipoId }, tenantId)).lean();
    if (!equipo) {
      throw new ApiError(404, 'Equipo no encontrado', 'EQUIPO_NOT_FOUND', { equipoId });
    }

    const existing = await EquipmentQr.findOne(applyTenantFilter({ equipoId }, tenantId)).lean();
    if (existing) {
      existing.qrImageDataUri = await this._readQrImageDataUri(existing);
      return { created: false, doc: existing };
    }

    try {
      const doc = new EquipmentQr({
        tenantId,
        equipoId,
        qrToken: nanoid(QR_TOKEN_LENGTH),
        active: true,
        createdBy: userId || null,
      });
      await doc.save();

      // PNG persistence is best-effort — the record exists either way.
      try {
        const landingUrl = this._buildLandingUrl(doc.qrToken);
        const buffer = await generateQrPng(landingUrl);
        const url = await uploadQrPng(buffer, tenantId, { id: doc._id.toString(), scope: QR_IMAGE_SCOPE });
        if (url) {
          doc.qrImageUrl = url;
          await doc.save();
        }
      } catch (pngErr) {
        logger.warn('equipmentQr: failed to persist QR PNG', { id: doc._id.toString(), err: String(pngErr) });
      }

      logger.info('EquipmentQr created', { tenantId, id: doc._id.toString(), equipoId });
      const json = doc.toJSON();
      json.qrImageDataUri = await this._readQrImageDataUri(doc);
      return { created: true, doc: json };
    } catch (err) {
      if (err && err.code === 11000) {
        // Race: another request created it first (design D13) — recover.
        const recovered = await EquipmentQr.findOne(applyTenantFilter({ equipoId }, tenantId)).lean();
        if (recovered) {
          recovered.qrImageDataUri = await this._readQrImageDataUri(recovered);
          return { created: false, doc: recovered };
        }
      }
      logger.error('Error creando EquipmentQr', { err: err && err.message, tenantId, equipoId });
      throw new ApiError(500, 'Error creando QR de equipo', 'CREATE_ERROR');
    }
  }

  /**
   * Bulk generation respecting MAX_BULK_SIZE (design D12). Returns
   * `{ created, reused, items }`.
   */
  async generateBulk(filter = {}, tenantId, userId = null) {
    requireTenant(tenantId);
    const query = this._buildEquipoFilter(filter, tenantId);

    const count = await EquipoItem.countDocuments(query);
    if (count > MAX_BULK_SIZE) {
      throw new ApiError(
        400,
        `El filtro resuelve ${count} equipos; agrega ClienteId, SedeId o Servicio para reducir a ${MAX_BULK_SIZE} o menos`,
        'BULK_LIMIT_EXCEEDED',
        { count, max: MAX_BULK_SIZE }
      );
    }

    const equipos = await EquipoItem.find(query).select('_id').lean();

    let created = 0;
    let reused = 0;
    const items = [];
    for (const eq of equipos) {
      const result = await this.generateForEquipo(eq._id.toString(), tenantId, userId);
      if (result.created) created += 1;
      else reused += 1;
      items.push(result.doc);
    }

    return { created, reused, items };
  }

  /**
   * Tenant-scoped, paginated admin listing — equipo-centric so the UI can
   * surface equipos WITHOUT a QR yet (needed to drive bulk-generate). Returns
   * one row per equipo matching the filter, with `qr: EquipmentQr | null`
   * left-joined. ClienteId is required to keep pagination bounded.
   */
  async list(filters = {}, pagination = {}, tenantId) {
    requireTenant(tenantId);
    const safeLimit = Math.min(Math.max(Number(pagination.limit) || 20, 1), 100);
    const safePage = Math.max(Number(pagination.page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const equipoFilter = this._buildEquipoFilter(filters, tenantId);

    const [equipos, total] = await Promise.all([
      EquipoItem.find(equipoFilter)
        .select('_id item Marca Modelo Serie Inventario Ubicacion EstadoOperativo ClienteId SedeId Servicio')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      EquipoItem.countDocuments(equipoFilter),
    ]);

    const equipoIds = equipos.map((e) => e._id);
    const qrs = equipoIds.length
      ? await EquipmentQr.find(applyTenantFilter({ equipoId: { $in: equipoIds } }, tenantId)).lean()
      : [];
    // Hydrate `qrImageDataUri` for each QR so the admin UI (<img src>) can
    // render the sticker preview without hitting the authenticated image
    // route (mirrors serviceQr.service.js:163-170).
    const dataUris = await Promise.all(qrs.map((q) => this._readQrImageDataUri(q)));
    qrs.forEach((q, i) => {
      q.qrImageDataUri = dataUris[i];
    });
    const qrByEquipoId = new Map(qrs.map((q) => [String(q.equipoId), q]));

    const data = equipos.map((e) => ({
      equipoId: String(e._id),
      item: e.item,
      marca: e.Marca,
      modelo: e.Modelo,
      serie: e.Serie,
      inventario: e.Inventario,
      ubicacion: e.Ubicacion,
      estadoOperativo: e.EstadoOperativo,
      qr: qrByEquipoId.get(String(e._id)) || null,
    }));

    return {
      data,
      pagination: { page: safePage, limit: safeLimit, total },
    };
  }

  /**
   * Resolve EquipmentQr `_id`s matching an admin filter, with no pagination.
   * Used by the PDF export controller to translate `?filter=<json>` into a
   * concrete id list before capping at MAX_BULK_PDF.
   */
  async resolveIdsForExport(filter = {}, tenantId) {
    requireTenant(tenantId);
    const query = applyTenantFilter({}, tenantId);
    const { ClienteId, SedeId, Servicio, EstadoOperativo, search } = filter;
    if (ClienteId || SedeId || Servicio || EstadoOperativo || search) {
      const equipoFilter = this._buildEquipoFilter({ ClienteId, SedeId, Servicio, EstadoOperativo, search }, tenantId);
      const equipoIds = await EquipoItem.find(equipoFilter).select('_id').lean();
      query.equipoId = { $in: equipoIds.map((e) => e._id) };
    }
    const docs = await EquipmentQr.find(query).select('_id').lean();
    return docs.map((d) => d._id.toString());
  }

  async getById(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'QR de equipo no encontrado', 'NOT_FOUND', { id });
    }
    const doc = await EquipmentQr.findOne(applyTenantFilter({ _id: id }, tenantId))
      .populate({ path: 'equipoId', select: 'Marca Modelo Serie Inventario Ubicacion EstadoOperativo item' });
    if (!doc) throw new ApiError(404, 'QR de equipo no encontrado', 'NOT_FOUND', { id });
    const json = doc.toJSON();
    json.qrImageDataUri = await this._readQrImageDataUri(doc);
    return json;
  }

  async deactivate(id, tenantId) {
    requireTenant(tenantId);
    const doc = await EquipmentQr.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { active: false } },
      { new: true }
    );
    if (!doc) throw new ApiError(404, 'QR de equipo no encontrado', 'NOT_FOUND', { id });
    return doc.toJSON();
  }

  async softDelete(id, tenantId) {
    requireTenant(tenantId);
    const doc = await EquipmentQr.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date(), active: false } },
      { new: true }
    );
    if (!doc) throw new ApiError(404, 'QR de equipo no encontrado', 'NOT_FOUND', { id });
    logger.info('EquipmentQr soft-deleted', { tenantId, id });
    return { id };
  }
}

export const equipmentQrService = new EquipmentQrService();
