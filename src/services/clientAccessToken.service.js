'use strict';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

import { ClientAccessToken } from '../models/clientAccessToken.model.js';
import { OT } from '../models/ot.model.js';
import { User } from '../models/user.model.js';
import { Customer } from '../models/customer.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { pushCorreoUsado } from '../utils/customerCorreosUsados.util.js';
import { env } from '../config/env.js';
import { CLIENT_TOKEN_LENGTH } from '../constants/clientPortal.constants.js';
import { emailService } from './external/email.service.js';

/**
 * ClientAccessTokenService — admin CRUD for the opaque client-portal token
 * (create, list, getById, revoke, softDelete). Every query is scoped by
 * tenantId (first parameter) per project convention.
 */
export class ClientAccessTokenService {
  /**
   * Creates a token granting read-only access to `otIds` (all must belong to
   * `clienteId`, none may be soft-deleted). Fail-fast if the ATTRIBUTED user
   * has no `fileFirma`. `attributionUserId` (optional in the body) is the
   * user whose signature will appear on the future HTs; if omitted, defaults
   * to the caller. Change 2026-08-03: previously the check was on the caller
   * (createdBy); now the caller may attribute a different técnico as long as
   * that user has a firma uploaded.
   */
  async create({ clienteId, otIds, attributionUserId }, tenantId, userId) {
    requireTenant(tenantId);

    const attribUserId = attributionUserId || userId;
    const attribUser = await User.findOne(applyTenantFilter({ _id: attribUserId }, tenantId))
      .select('fileFirma')
      .lean();
    if (!attribUser) {
      throw new ApiError(400, 'Usuario atribuido no encontrado', 'ATTRIBUTION_USER_NOT_FOUND');
    }
    if (!attribUser.fileFirma) {
      const msg = String(attribUserId) === String(userId)
        ? 'Tu perfil no tiene firma cargada. Súbela desde tu perfil antes de emitir accesos cliente.'
        : 'El técnico seleccionado no tiene firma cargada. Selecciona otro o pídele que la suba.';
      throw new ApiError(400, msg, 'USER_SIGNATURE_MISSING');
    }

    // Single query for all otIds — OT's default pre('find') already excludes
    // soft-deleted docs, so a length mismatch covers "not found" AND
    // "soft-deleted" AND "belongs to another tenant" in one check.
    const ots = await OT.find(applyTenantFilter({ _id: { $in: otIds } }, tenantId))
      .select('ClienteId')
      .lean();
    if (ots.length !== otIds.length) {
      throw new ApiError(400, 'Una o más OT no están disponibles', 'OT_NOT_AVAILABLE');
    }

    const mismatched = ots.some((ot) => String(ot.ClienteId) !== String(clienteId));
    if (mismatched) {
      throw new ApiError(
        400,
        'Todas las OT deben pertenecer al mismo cliente',
        'OT_CLIENT_MISMATCH'
      );
    }

    const token = nanoid(CLIENT_TOKEN_LENGTH);

    const doc = new ClientAccessToken({
      tenantId,
      clienteId,
      otIds,
      token,
      status: 'active',
      createdBy: userId,
      attributionUserId: attribUserId,
    });
    // Defensive, DB-free cross-check at the model layer (see model comment).
    doc.otClienteIds = ots.map((ot) => ot.ClienteId);

    try {
      await doc.save();
    } catch (err) {
      if (err && err.message === 'OT_CLIENT_MISMATCH') {
        throw new ApiError(
          400,
          'Todas las OT deben pertenecer al mismo cliente',
          'OT_CLIENT_MISMATCH'
        );
      }
      if (err && err.code === 11000) {
        // Astronomically unlikely nanoid collision — surface as 500 for retry.
        logger.error('ClientAccessToken token collision on create', { tenantId });
        throw new ApiError(500, 'Error creando el acceso, intenta nuevamente', 'CREATE_ERROR');
      }
      throw err;
    }

    logger.info('ClientAccessToken created', { tenantId, id: doc._id.toString() });

    const baseUrl = (env.PUBLIC_APP_BASE_URL || '').replace(/\/+$/, '');
    return {
      id: doc._id.toString(),
      token: doc.token,
      url: `${baseUrl}/portal/${doc.token}`,
    };
  }

  /** Lists tokens for the caller's tenant, filtered by clienteId/status, paginated. */
  async listByTenant(filters = {}, pagination = {}, tenantId) {
    requireTenant(tenantId);
    const { page = 1, limit = 50 } = pagination;
    const skip = (page - 1) * limit;

    const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);

    const [data, total] = await Promise.all([
      ClientAccessToken.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientAccessToken.countDocuments(query),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  /** Retrieves a single token, populated with OT summaries and creator's fullName. */
  async getById(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    const doc = await ClientAccessToken.findOne(applyTenantFilter({ _id: id }, tenantId))
      .populate('otIds', 'Consecutivo EstadoOt Avance')
      .populate('createdBy', 'fullName')
      .populate('attributionUserId', 'fullName');
    // Cross-tenant lookups never match the filter above — 404, no existence leak.
    if (!doc) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    return doc.toJSON();
  }

  /** Revokes an active token. Idempotency: revoking twice returns 409. */
  async revoke(id, tenantId, revokedByUserId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    const doc = await ClientAccessToken.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!doc) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    if (doc.status === 'revoked') {
      throw new ApiError(409, 'El acceso ya fue revocado', 'TOKEN_ALREADY_REVOKED');
    }
    doc.status = 'revoked';
    doc.revokedAt = new Date();
    doc.revokedBy = revokedByUserId;
    await doc.save();
    logger.info('ClientAccessToken revoked', { tenantId, id });
    return doc.toJSON();
  }

  /**
   * Appends OTs to an active token via `$addToSet`. Every submitted OT must
   * belong to the token's clienteId; length mismatch or cross-tenant → 400.
   * Revoked tokens → 409; missing / soft-deleted / cross-tenant → 404.
   * Returns the token populated (otIds with summary + creator names) so the
   * frontend can render without a refetch.
   */
  async addOts(id, otIds, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    const uniqueRequested = Array.from(new Set((otIds || []).map(String)));
    if (uniqueRequested.length === 0) {
      throw new ApiError(400, 'Debes indicar al menos una OT', 'OT_LIST_EMPTY');
    }

    const doc = await ClientAccessToken.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!doc) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    if (doc.status === 'revoked') {
      throw new ApiError(409, 'El acceso está revocado y no puede editarse', 'TOKEN_REVOKED');
    }

    // Single query — misses (missing / soft-deleted / cross-tenant) all
    // manifest as a length mismatch, same pattern as `create`.
    const ots = await OT.find(applyTenantFilter({ _id: { $in: uniqueRequested } }, tenantId))
      .select('ClienteId')
      .lean();
    if (ots.length !== uniqueRequested.length) {
      throw new ApiError(400, 'Una o más OT no están disponibles', 'OT_NOT_AVAILABLE');
    }

    const clienteId = String(doc.clienteId);
    const mismatched = ots.some((ot) => String(ot.ClienteId) !== clienteId);
    if (mismatched) {
      throw new ApiError(
        400,
        'Todas las OT deben pertenecer al mismo cliente del acceso',
        'OT_CLIENT_MISMATCH'
      );
    }

    // Filter out OTs already in the token — the model's pre('validate') hook
    // cross-checks against clienteId via the transient `otClienteIds` virtual,
    // and $addToSet handles dedupe at the DB layer, but doing it here too
    // lets us short-circuit when nothing new is being added.
    const existing = new Set(doc.otIds.map(String));
    const toAppend = uniqueRequested.filter((otId) => !existing.has(otId));

    if (toAppend.length > 0) {
      await ClientAccessToken.updateOne(
        applyTenantFilter({ _id: doc._id }, tenantId),
        { $addToSet: { otIds: { $each: toAppend } } }
      );
    }

    logger.info('ClientAccessToken addOts', {
      tenantId,
      id: doc._id.toString(),
      appended: toAppend.length,
      requested: uniqueRequested.length,
    });

    // Return the populated token so the UI updates in place.
    return this.getById(String(doc._id), tenantId);
  }

  /**
   * Dispatches the portal link to `email` via the transactional email
   * service and records the attempt on `emailHistory`. Failure to send
   * (Resend down, notifications disabled) STILL records the attempt so
   * the audit trail reflects intent (D6).
   */
  async sendLink(id, email, tenantId, userId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    const normalized = String(email || '').toLowerCase().trim();
    if (!normalized) {
      throw new ApiError(400, 'Correo requerido', 'EMAIL_REQUIRED');
    }

    const doc = await ClientAccessToken.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!doc) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    if (doc.status === 'revoked') {
      throw new ApiError(409, 'El acceso está revocado y no puede reenviarse', 'TOKEN_REVOKED');
    }

    const customer = await Customer.findOne(applyTenantFilter({ _id: doc.clienteId }, tenantId))
      .select('Razonsocial')
      .lean();
    const requester = userId
      ? await User.findById(userId).select('fullName').lean()
      : null;

    const baseUrl = (env.PUBLIC_APP_BASE_URL || '').replace(/\/+$/, '');
    const portalUrl = `${baseUrl}/portal/${doc.token}`;

    let emailSent = false;
    if (env.NOTIFICATIONS_ENABLED) {
      try {
        const result = await emailService.sendClientPortalLinkEmail({
          to: normalized,
          clienteName: customer?.Razonsocial || 'Cliente',
          portalUrl,
          requesterName: requester?.fullName || 'TIMTTO',
        });
        emailSent = Boolean(result?.sent);
      } catch (err) {
        logger.warn('sendLink: email dispatch failed', {
          tokenId: String(doc._id),
          err: String(err),
        });
      }
    }

    // Record the attempt regardless of transport outcome (D6).
    const now = new Date();
    await ClientAccessToken.updateOne(
      applyTenantFilter({ _id: doc._id }, tenantId),
      {
        $set: {
          'emailHistory.lastEmail': normalized,
          'emailHistory.lastSentAt': now,
          'emailHistory.lastSentBy': userId || null,
        },
        $inc: { 'emailHistory.sendCount': 1 },
      }
    );

    await pushCorreoUsado(doc.clienteId, tenantId, normalized);

    logger.info('ClientAccessToken sendLink', {
      tenantId,
      id: doc._id.toString(),
      emailSent,
    });

    return {
      id: doc._id.toString(),
      email: normalized,
      sentAt: now,
      emailSent,
    };
  }

  /** Soft-deletes a token. Only allowed once the token is revoked. */
  async softDelete(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    const doc = await ClientAccessToken.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!doc) {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND', { id });
    }
    if (doc.status !== 'revoked') {
      throw new ApiError(
        409,
        'El acceso debe estar revocado antes de eliminarlo',
        'TOKEN_MUST_BE_REVOKED_FIRST'
      );
    }
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    await doc.save();
    logger.info('ClientAccessToken soft-deleted', { tenantId, id });
  }
}

export const clientAccessTokenService = new ClientAccessTokenService();
