import mongoose from 'mongoose';
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { Customer } from '../models/customer.model.js';
import { HVEquipo } from '../models/hvequipo.model.js';
import { OT } from '../models/ot.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { emailService } from './external/email.service.js';
import { generateTemporaryPassword } from '../utils/temporaryPassword.util.js';
import { logger } from '../config/logger.config.js';
import { env } from '../config/env.js';

// OT statuses counted as "open" per domain spec §Requirement: Detalle con contadores
const OPEN_OT_STATUSES = ['Pendiente', 'Abierto', 'En Progreso'];

/**
 * Returns true when the error indicates the MongoDB deployment does not support
 * transactions (single-node, no replica set — typical in local dev with default
 * Docker Mongo or Atlas dev tier without replica set configured).
 */
function isTransactionUnsupportedError(err) {
  return (
    err?.code === 20 ||
    err?.codeName === 'IllegalOperation' ||
    (typeof err?.message === 'string' &&
      err.message.includes('Transaction numbers are only allowed'))
  );
}

/**
 * PlatformTenantService — cross-tenant operations for SuperAdmin.
 *
 * NOTE: these methods intentionally do NOT take `tenantId` as first parameter
 * because they operate across all tenants. This is the documented exception to
 * the multi-tenant invariant (design D2).
 */
export class PlatformTenantService {
  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------

  /**
   * Paginates all tenants with optional filters.
   * Soft-deleted tenants excluded by default.
   *
   * @param {object} opts
   * @param {number} [opts.page=1]
   * @param {number} [opts.limit=10]
   * @param {string} [opts.status]  'active' | 'suspended' | 'closed'
   * @param {string} [opts.plan]
   * @param {string} [opts.search]  Case-insensitive match on tenantId, name, email
   * @param {boolean} [opts.includeDeleted=false]
   */
  static async list({ page = 1, limit = 10, status, plan, search, includeDeleted = false } = {}) {
    const skip = (page - 1) * limit;
    const query = {};

    // includeDeleted opt-in: pass explicit filter; the pre hook is bypassed via
    // setOptions({ includeDeleted: true }) below regardless of which branch runs.
    if (!includeDeleted) {
      query.isDeleted = false;
    }

    if (status) query.status = status;
    if (plan) query.plan = plan;

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { tenantId: regex },
        { name: regex },
        { email: regex },
      ];
    }

    const [data, total] = await Promise.all([
      Tenant.find(query)
        .setOptions({ includeDeleted: true }) // bypass pre-hook; filter already explicit
        .skip(skip)
        .limit(limit)
        .lean(),
      Tenant.countDocuments(query).setOptions({ includeDeleted: true }),
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

  /**
   * Returns a single tenant by MongoDB _id plus computed domain counters.
   *
   * @param {string} id  MongoDB ObjectId (hex string)
   */
  static async getById(id) {
    const tenant = await Tenant.findById(id)
      .setOptions({ includeDeleted: true })
      .lean();
    if (!tenant) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');

    const { tenantId } = tenant;

    // Parallel counting — cheap at this scale; if tenant count grows, add TTL cache.
    // countDocuments does not trigger pre(/^find/) hooks, so isDeleted is explicit.
    const [usersCount, customersCount, equiposCount, otsAbiertas] = await Promise.all([
      User.countDocuments({ tenantId, isDeleted: false }),
      Customer.countDocuments({ tenantId, isDeleted: false }),
      HVEquipo.countDocuments({ tenantId, isDeleted: false }),
      OT.countDocuments({ tenantId, isDeleted: false, EstadoOt: { $in: OPEN_OT_STATUSES } }),
    ]);

    return {
      tenant,
      counters: { usersCount, customersCount, equiposCount, otsAbiertas },
    };
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  /**
   * Creates a Tenant + first admin User atomically.
   * Uses Mongoose sessions + withTransaction (requires Atlas / replica set).
   * Falls back to compensatory flow on single-node MongoDB (design D1).
   *
   * If a logoFile is provided, it is uploaded to Firebase Storage BEFORE the
   * transaction begins. If the transaction fails, the uploaded logo becomes
   * orphaned — acceptable trade-off given Firebase is outside Mongo tx scope.
   *
   * @param {object} payload
   * @param {object} payload.tenant  Tenant data (already validated by DTO)
   * @param {object} payload.admin   Admin user data
   * @param {object|null} [logoFile] Multer file object { buffer, originalname, mimetype }
   * @returns {{ tenant, admin, temporaryPassword }}
   */
  static async createWithAdmin({ tenant: tenantData, admin: adminData }, logoFile = null) {
    // Fast-fail: tenantId uniqueness check before touching the DB in a loop
    const existing = await Tenant.findOne({ tenantId: tenantData.tenantId })
      .setOptions({ includeDeleted: true })
      .lean();
    if (existing) {
      throw new ApiError(409, `El tenant '${tenantData.tenantId}' ya existe`, 'TENANT_EXISTS');
    }

    const temporaryPassword = generateTemporaryPassword();

    const tenantPayload = { ...tenantData, status: 'active' };

    // Optional logo upload — before the transaction so a failed upload aborts
    // creation cleanly. Orphan logos on transaction failure are acceptable.
    if (logoFile && logoFile.buffer) {
      logger.info('PlatformTenantService.createWithAdmin: uploading tenant logo');
      tenantPayload.logoUrl = await firebaseStorageService.uploadLogo(
        logoFile.buffer,
        logoFile.originalname,
        logoFile.mimetype,
        'logos/tenants',
      );
    }
    const adminPayload = {
      tenantId: tenantData.tenantId,
      email: adminData.email,
      firstName: adminData.firstName,
      lastName: adminData.lastName,
      ...(adminData.phone ? { phone: adminData.phone } : {}),
      role: 'admin',
      password: temporaryPassword,
      mustChangePassword: true,
    };

    let session;
    try {
      session = await mongoose.startSession();

      let createdTenant;
      let createdAdmin;

      await session.withTransaction(async () => {
        [createdTenant] = await Tenant.create([tenantPayload], { session });
        // Ensure tenantId is consistent with what was persisted (lowercase enforced by schema)
        adminPayload.tenantId = createdTenant.tenantId;
        [createdAdmin] = await User.create([adminPayload], { session });
      });

      logger.info('PlatformTenantService.createWithAdmin: success via transaction', {
        tenantId: createdTenant.tenantId,
        adminEmail: createdAdmin.email,
      });

      // Fire-and-forget the welcome email so the HTTP response is not blocked
      // by the SMTP round-trip (~1-10s to Resend). Design D4/D8: `emailSent`
      // is best-effort intent, not delivery confirmation. Failures logged in
      // the email service. Defensive modal shows the password anyway.
      emailService
        .sendWelcomeEmail({
          to: createdAdmin.email,
          tenantName: createdTenant.name,
          tenantId: createdTenant.tenantId,
          adminFirstName: createdAdmin.firstName,
          temporaryPassword,
          loginUrl: env.PUBLIC_APP_URL + '/login',
        })
        .catch((err) => logger.error('platformTenant(tx): unhandled email error', { tenantId: createdTenant.tenantId, error: err.message }));

      return {
        tenant: createdTenant.toJSON(),
        admin: createdAdmin.toJSON(), // password stripped by toJSON transform
        temporaryPassword,
        emailSent: env.NOTIFICATIONS_ENABLED === true,
      };
    } catch (txErr) {
      if (isTransactionUnsupportedError(txErr)) {
        logger.warn(
          'PlatformTenantService.createWithAdmin: transactions unsupported, using compensatory flow',
          { code: txErr.code, message: txErr.message },
        );
        return PlatformTenantService._createWithAdminCompensatory(
          tenantPayload,
          adminPayload,
          temporaryPassword,
        );
      }
      throw txErr;
    } finally {
      if (session) {
        try { await session.endSession(); } catch (_) { /* best-effort */ }
      }
    }
  }

  /**
   * Compensatory (non-transactional) flow for environments without a replica set.
   * Creates the Tenant first, then the User. If User creation fails, soft-deletes
   * the Tenant to compensate (design D1).
   * @private
   */
  static async _createWithAdminCompensatory(tenantPayload, adminPayload, temporaryPassword) {
    let createdTenant;
    try {
      createdTenant = await Tenant.create(tenantPayload);
    } catch (err) {
      throw err; // tenant creation itself failed — nothing to compensate
    }

    try {
      const createdAdmin = await User.create({
        ...adminPayload,
        tenantId: createdTenant.tenantId,
      });
      logger.info('PlatformTenantService._createWithAdminCompensatory: success', {
        tenantId: createdTenant.tenantId,
      });

      // Fire-and-forget (see comment in transaction path above).
      emailService
        .sendWelcomeEmail({
          to: createdAdmin.email,
          tenantName: createdTenant.name,
          tenantId: createdTenant.tenantId,
          adminFirstName: createdAdmin.firstName,
          temporaryPassword,
          loginUrl: env.PUBLIC_APP_URL + '/login',
        })
        .catch((err) => logger.error('platformTenant(compensatory): unhandled email error', { tenantId: createdTenant.tenantId, error: err.message }));

      return {
        tenant: createdTenant.toJSON(),
        admin: createdAdmin.toJSON(),
        temporaryPassword,
        emailSent: env.NOTIFICATIONS_ENABLED === true,
      };
    } catch (userErr) {
      logger.error(
        'PlatformTenantService._createWithAdminCompensatory: user creation failed, compensating',
        { tenantId: createdTenant?.tenantId, error: userErr.message },
      );
      // Compensate: soft-delete the orphaned tenant
      await Tenant.updateOne(
        { _id: createdTenant._id },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );
      throw userErr;
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  /**
   * Updates editable metadata for a tenant.
   * Protected fields (tenantId, status, plan, ownerId) are stripped as a
   * second layer of defence even if the DTO already rejects them.
   *
   * @param {string} id         MongoDB ObjectId
   * @param {object} payload    Validated metadata fields
   * @param {object} [logoFile] Optional multer file object { buffer, originalname, mimetype }
   */
  static async updateMetadata(id, payload, logoFile = null) {
    const tenant = await Tenant.findById(id).setOptions({ includeDeleted: true });
    if (!tenant) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');

    // Defence-in-depth: strip protected fields regardless of DTO
    // eslint-disable-next-line no-unused-vars
    const { tenantId: _t, status: _s, plan: _p, ownerId: _o, ...safePayload } = payload;

    if (logoFile?.buffer) {
      logger.info('PlatformTenantService.updateMetadata: replacing logo in Firebase Storage');
      const newLogoUrl = await firebaseStorageService.replaceLogo(
        tenant.logoUrl,
        logoFile.buffer,
        logoFile.originalname,
        logoFile.mimetype,
      );
      safePayload.logoUrl = newLogoUrl;
    }

    const updated = await Tenant.findByIdAndUpdate(
      id,
      { $set: safePayload },
      { new: true },
    )
      .setOptions({ includeDeleted: true })
      .lean();

    return updated;
  }

  // ---------------------------------------------------------------------------
  // STATUS TRANSITIONS
  // ---------------------------------------------------------------------------

  /**
   * Suspends a tenant.
   *
   * @param {string} id       MongoDB ObjectId
   * @param {string} reason   Mandatory reason for suspension
   * @param {string} actorId  SuperAdmin userId (for audit log)
   */
  static async suspend(id, reason, actorId) {
    const tenant = await Tenant.findById(id).setOptions({ includeDeleted: true }).lean();
    if (!tenant) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    if (tenant.status === 'suspended') {
      throw new ApiError(409, 'El tenant ya está suspendido', 'TENANT_ALREADY_SUSPENDED');
    }

    const updated = await Tenant.findByIdAndUpdate(
      id,
      { $set: { status: 'suspended' } },
      { new: true },
    )
      .setOptions({ includeDeleted: true })
      .lean();

    logger.info('PlatformTenantService.suspend: tenant suspended', {
      tenantId: tenant.tenantId,
      reason,
      actorId,
    });

    return updated;
  }

  /**
   * Reactivates a suspended or closed tenant.
   *
   * @param {string} id       MongoDB ObjectId
   * @param {string} actorId  SuperAdmin userId (for audit log)
   */
  static async reactivate(id, actorId) {
    const tenant = await Tenant.findById(id).setOptions({ includeDeleted: true }).lean();
    if (!tenant) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    if (tenant.status === 'active') {
      throw new ApiError(409, 'El tenant ya está activo', 'TENANT_ALREADY_ACTIVE');
    }

    const updated = await Tenant.findByIdAndUpdate(
      id,
      { $set: { status: 'active' } },
      { new: true },
    )
      .setOptions({ includeDeleted: true })
      .lean();

    logger.info('PlatformTenantService.reactivate: tenant reactivated', {
      tenantId: tenant.tenantId,
      actorId,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------

  /**
   * Soft-deletes a tenant. No restore endpoint is exposed from the UI (design D9).
   *
   * @param {string} id       MongoDB ObjectId
   * @param {string} actorId  SuperAdmin userId (for audit log)
   */
  static async softDelete(id, actorId) {
    const tenant = await Tenant.findById(id).setOptions({ includeDeleted: true }).lean();
    if (!tenant) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    if (tenant.isDeleted) {
      throw new ApiError(409, 'El tenant ya está eliminado', 'TENANT_ALREADY_DELETED');
    }

    const updated = await Tenant.findByIdAndUpdate(
      id,
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    )
      .setOptions({ includeDeleted: true })
      .lean();

    logger.info('PlatformTenantService.softDelete: tenant soft-deleted', {
      tenantId: tenant.tenantId,
      actorId,
    });

    return updated;
  }
}

export const platformTenantService = PlatformTenantService;
