'use strict';
import path from 'path';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import mongoose from 'mongoose';

import { ServiceQr } from '../models/serviceQr.model.js';
import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Servicios } from '../models/servicios.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { jwtConfig } from '../config/jwt.config.js';
import { env } from '../config/env.js';
import {
  QR_PASSWORD_BCRYPT_ROUNDS,
  QR_TOKEN_LENGTH,
} from '../constants/serviceQr.constants.js';

/**
 * ServiceQrService implements creation, listing, password rotation,
 * deactivation, soft-delete and the public validate-access flow that
 * issues sessionTokens signed with JWT_PUBLIC_SECRET (separate from
 * JWT_SECRET per design D7).
 */
export class ServiceQrService {
  /**
   * Resolve and validate that ClienteId, sedeId, servicioId all belong to the
   * tenant. Returns the populated descriptor used by the public response.
   */
  async _resolveScope(tenantId, { ClienteId, sedeId, servicioId }) {
    const [cliente, sede, servicio] = await Promise.all([
      Customer.findOne(applyTenantFilter({ _id: ClienteId }, tenantId)).lean(),
      Sedes.findOne(applyTenantFilter({ _id: sedeId }, tenantId)).lean(),
      Servicios.findOne(applyTenantFilter({ _id: servicioId }, tenantId)).lean(),
    ]);
    if (!cliente) {
      throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND', { ClienteId });
    }
    if (!sede) {
      throw new ApiError(404, 'Sede no encontrada', 'SEDE_NOT_FOUND', { sedeId });
    }
    if (!servicio) {
      throw new ApiError(404, 'Servicio no encontrado', 'SERVICIO_NOT_FOUND', { servicioId });
    }
    return { cliente, sede, servicio };
  }

  /**
   * Generate a PNG for the QR landing URL and persist it under
   * env.QR_IMAGE_STORAGE_PATH. Returns a relative URL (the controller
   * serves it via GET /api/service-qrs/:id/qr-image).
   *
   * Errors here are non-fatal: the QR record still exists, qrImageUrl just
   * remains null and the caller can re-generate later.
   */
  async _generateQrPng(qrId, qrToken) {
    try {
      const baseDir = path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH);
      await fs.mkdir(baseDir, { recursive: true });
      const filename = `${qrId}.png`;
      const fullPath = path.join(baseDir, filename);
      const landingUrl = `${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/public/ticket/${qrToken}`;
      await QRCode.toFile(fullPath, landingUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512,
      });
      return `/api/v1/service-qrs/${qrId}/qr-image`;
    } catch (err) {
      logger.warn('serviceQr: failed to persist QR PNG', { qrId, err: String(err) });
      return null;
    }
  }

  /**
   * Read the persisted PNG and return a `data:image/png;base64,...` URI.
   * This avoids the auth-on-img-tag problem (browsers don't send Authorization
   * headers on <img src=...>), and gives the frontend a payload that can be
   * embedded directly into a PDF without an extra fetch.
   * Returns null if the file is missing.
   */
  async _readQrImageDataUri(qrId) {
    try {
      const baseDir = path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH);
      const fullPath = path.join(baseDir, `${qrId}.png`);
      const buf = await fs.readFile(fullPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async create(payload, tenantId, userId = null) {
    requireTenant(tenantId);
    const { ClienteId, sedeId, servicioId, password } = payload;

    await this._resolveScope(tenantId, { ClienteId, sedeId, servicioId });

    // Pre-check existing active QR for the same scope (clearer 409 than the
    // partial-unique index error).
    const existing = await ServiceQr.findOne(
      applyTenantFilter({ ClienteId, sedeId, servicioId }, tenantId)
    ).lean();
    if (existing) {
      throw new ApiError(409, 'Ya existe un QR activo para este servicio', 'QR_ALREADY_EXISTS');
    }

    try {
      // Hash explicitly here instead of relying on the virtual+pre-save dance
      // (Mongoose 8.x was dropping `_plainPassword` set via virtual setter,
      // causing `passwordHash required` validation errors).
      const salt = await bcrypt.genSalt(QR_PASSWORD_BCRYPT_ROUNDS);
      const passwordHash = await bcrypt.hash(password, salt);

      const doc = new ServiceQr({
        tenantId,
        ClienteId,
        sedeId,
        servicioId,
        qrToken: nanoid(QR_TOKEN_LENGTH),
        passwordHash,
        active: true,
        passwordRotatedAt: new Date(),
        createdBy: userId || null,
      });
      await doc.save();

      // Persist PNG; best-effort.
      const url = await this._generateQrPng(doc._id.toString(), doc.qrToken);
      if (url) {
        doc.qrImageUrl = url;
        await doc.save();
      }
      logger.info('ServiceQr created', { tenantId, id: doc._id.toString() });
      return doc.toJSON();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err && err.code === 11000) {
        throw new ApiError(409, 'Ya existe un QR activo para este servicio', 'QR_ALREADY_EXISTS');
      }
      logger.error('Error creando ServiceQr', { err: err && err.message });
      throw new ApiError(500, 'Error creando ServiceQr', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    requireTenant(tenantId);
    const { page = 1, limit = 50, sortBy = 'createdAt', order = 'desc' } = pagination;
    const skip = (page - 1) * limit;
    const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);
    const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
    const [data, total] = await Promise.all([
      ServiceQr.find(query)
        .populate('ClienteId', 'Razonsocial Nit')
        .populate('sedeId', 'nombreSede')
        .populate('servicioId', 'nombre')
        .populate('createdBy', 'firstName lastName email')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      ServiceQr.countDocuments(query),
    ]);

    // Augment each QR with the base64 data URI of its PNG so the frontend
    // can render <img> without hitting the authenticated /qr-image route.
    const dataUris = await Promise.all(
      data.map((qr) => this._readQrImageDataUri(qr._id.toString())),
    );
    data.forEach((qr, i) => {
      qr.qrImageDataUri = dataUris[i];
    });

    return {
      data,
      pagination: {
        page, limit, total, pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit), hasPrev: page > 1,
      },
    };
  }

  async findById(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });
    }
    const doc = await ServiceQr.findOne(applyTenantFilter({ _id: id }, tenantId))
      .populate('ClienteId', 'Razonsocial Nit')
      .populate('sedeId', 'nombreSede')
      .populate('servicioId', 'nombre')
      .populate('createdBy', 'firstName lastName email');
    if (!doc) throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });
    const json = doc.toJSON();
    json.qrImageDataUri = await this._readQrImageDataUri(id);
    return json;
  }

  async rotatePassword(id, newPassword, tenantId) {
    requireTenant(tenantId);
    const doc = await ServiceQr.findOne(applyTenantFilter({ _id: id }, tenantId)).select('+passwordHash');
    if (!doc) throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });

    // Hash explicitly (same fix as create() — virtual+pre-save was unreliable).
    const salt = await bcrypt.genSalt(QR_PASSWORD_BCRYPT_ROUNDS);
    doc.passwordHash = await bcrypt.hash(newPassword, salt);
    doc.passwordRotatedAt = new Date();
    await doc.save();
    logger.info('ServiceQr password rotated', { tenantId, id });
    return doc.toJSON();
  }

  async deactivate(id, tenantId) {
    requireTenant(tenantId);
    const doc = await ServiceQr.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { active: false } },
      { new: true }
    );
    if (!doc) throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });
    return doc.toJSON();
  }

  async activate(id, tenantId) {
    requireTenant(tenantId);
    const doc = await ServiceQr.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { active: true } },
      { new: true }
    );
    if (!doc) throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });
    return doc.toJSON();
  }

  async softDelete(id, tenantId) {
    requireTenant(tenantId);
    const doc = await ServiceQr.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date(), active: false } },
      { new: true }
    );
    if (!doc) throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });
    logger.info('ServiceQr soft-deleted', { tenantId, id });
    return { id };
  }

  /**
   * Public: validate qrToken + password. Returns sessionToken signed with
   * JWT_PUBLIC_SECRET. Uses a generic 401 INVALID_CREDENTIALS for any
   * failure mode to avoid leaking whether the token or password was wrong.
   */
  async validateAccess({ qrToken, password }) {
    if (!qrToken || !password) {
      throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    // Find by qrToken across all tenants (token is globally unique).
    // Include passwordHash explicitly (select:false on schema).
    const qr = await ServiceQr.findOne({ qrToken }).select('+passwordHash');
    if (!qr || qr.isDeleted || !qr.active) {
      throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    const ok = await qr.comparePassword(password);
    if (!ok) {
      throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    const payload = {
      serviceQrId: qr._id.toString(),
      tenantId: qr.tenantId,
      ClienteId: qr.ClienteId.toString(),
      sedeId: qr.sedeId.toString(),
      servicioId: qr.servicioId.toString(),
    };

    const sessionToken = jwt.sign(payload, jwtConfig.publicSession.secret, {
      expiresIn: jwtConfig.publicSession.expiresIn,
    });

    // Resolve display names for the public response.
    const [cliente, sede, servicio] = await Promise.all([
      Customer.findById(qr.ClienteId).select('Razonsocial Nit').lean(),
      Sedes.findById(qr.sedeId).select('nombreSede').lean(),
      Servicios.findById(qr.servicioId).select('nombre').lean(),
    ]);

    return {
      sessionToken,
      qr: {
        id: qr._id.toString(),
        cliente: cliente ? { id: cliente._id, name: cliente.Razonsocial } : null,
        sede: sede ? { id: sede._id, name: sede.nombreSede } : null,
        servicio: servicio ? { id: servicio._id, name: servicio.nombre } : null,
      },
    };
  }

  /**
   * Returns the descriptor for the currently active public session.
   * Used by GET /public/tickets/session/me.
   */
  async describeSession(publicSession) {
    if (!publicSession) {
      throw new ApiError(401, 'No public session', 'NO_SESSION');
    }
    const [cliente, sede, servicio] = await Promise.all([
      Customer.findById(publicSession.ClienteId).select('Razonsocial Nit').lean(),
      Sedes.findById(publicSession.sedeId).select('nombreSede').lean(),
      Servicios.findById(publicSession.servicioId).select('nombre').lean(),
    ]);
    return {
      qrId: publicSession.serviceQrId,
      cliente: cliente ? { id: cliente._id, name: cliente.Razonsocial } : null,
      sede: sede ? { id: sede._id, name: sede.nombreSede } : null,
      servicio: servicio ? { id: servicio._id, name: servicio.nombre } : null,
    };
  }

  /**
   * Returns the absolute filesystem path to the persisted PNG for the given
   * QR id, or null if not found / out of the tenant. Used by the controller
   * to stream the file.
   */
  async getQrImagePath(id, tenantId) {
    requireTenant(tenantId);
    const qr = await ServiceQr.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!qr) throw new ApiError(404, 'ServiceQr no encontrado', 'NOT_FOUND', { id });
    const baseDir = path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH);
    const fullPath = path.join(baseDir, `${id}.png`);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch (_) {
      // Try to regenerate on demand.
      const regen = await this._generateQrPng(id, qr.qrToken);
      if (!regen) throw new ApiError(404, 'QR image not found', 'QR_IMAGE_NOT_FOUND', { id });
      return fullPath;
    }
  }
}

export const serviceQrService = new ServiceQrService();
