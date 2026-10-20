import mongoose from 'mongoose';
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { Role } from '../models/role.model.js';
import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Servicios } from '../models/servicios.model.js';
import { HVEquipo } from '../models/hvequipo.model.js';
import { OT } from '../models/ot.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { emailService } from './external/email.service.js';
import { generateTemporaryPassword } from '../utils/temporaryPassword.util.js';
import { PERMISSION_VALUES } from '../constants/permissions.js';
import { logger } from '../config/logger.config.js';
import { env } from '../config/env.js';
import {
  getTenantType,
  normalizeCapabilities,
  resolveCapabilitiesInput,
} from '../config/tenantCapabilities.config.js';

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

// Tenant data required to build the organization client (tenant-capabilities-hybrid-mode, design D7).
const ORGANIZATION_REQUIRED_FIELDS = ['nit', 'ciudad', 'departamento', 'email', 'telefono'];

/** Numeric NIT = the digits before the first '-' of the tenant NIT (verification digit dropped). */
function parseNit(nit) {
  const digits = String(nit ?? '').split('-')[0].replace(/[^0-9]/g, '');
  const value = digits ? Number(digits) : NaN;
  // Customer.Nit is a Number: refuse values that cannot be represented exactly.
  return Number.isSafeInteger(value) ? value : NaN;
}

/**
 * Builds the Customer document of the organization client from the tenant data, WITHOUT a logo
 * (the PDF header shows only the tenant logo). Throws 400 TENANT_DATA_INCOMPLETE when the tenant
 * lacks what Customer and its default Sede require, so nothing is created halfway.
 *
 * @param {object} tenant       tenant data (tenantId, name, nit, ciudad, departamento, email, telefono, direccion)
 * @param {string} contactName  contact person (the tenant admin's full name)
 */
function buildOrganizationCustomerData(tenant, contactName) {
  const missing = ORGANIZATION_REQUIRED_FIELDS.filter((f) => String(tenant?.[f] ?? '').trim() === '');
  const nit = parseNit(tenant?.nit);
  if (!missing.includes('nit') && !Number.isFinite(nit)) missing.push('nit');
  if (missing.length) {
    throw new ApiError(
      400,
      `Para crear el cliente de la organización el tenant requiere: ${missing.join(', ')}`,
      'TENANT_DATA_INCOMPLETE',
      { fields: missing },
    );
  }
  const data = {
    tenantId: tenant.tenantId,
    kind: 'customer',
    Razonsocial: tenant.name,
    Nit: nit,
    Ciudad: tenant.ciudad,
    Departamento: tenant.departamento,
    Email: tenant.email,
    TelContacto: tenant.telefono,
    UserContacto: String(contactName || tenant.name).trim(),
  };
  if (String(tenant.direccion ?? '').trim()) data.Direccion = tenant.direccion;
  return data;
}

/** Creates one document, inside the session when there is one (Model.create needs an array then). */
async function createDoc(Model, doc, session) {
  if (session) {
    const [created] = await Model.create([doc], { session });
    return created;
  }
  return Model.create(doc);
}

/** Best-effort soft delete used by the non-transactional compensating flows (never a hard delete). */
async function softDeleteCreated(created) {
  for (const [Model, _id] of created) {
    try {
      await Model.updateOne({ _id }, { $set: { isDeleted: true, deletedAt: new Date() } });
    } catch (err) {
      logger.error('PlatformTenantService: compensation failed', { model: Model.modelName, error: err.message });
    }
  }
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
      Customer.countDocuments({ tenantId, isDeleted: false, kind: { $ne: 'provider' } }),
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
   * @param {string} [payload.type]  Preset: 'provider' (default) | 'client' | 'hybrid'
   * @param {object} [payload.capabilities] Explicit flags { executesServices, registersExternal }
   *   (`type` / `capabilities` may also arrive inside payload.tenant)
   * @param {object|null} [logoFile] Multer file object { buffer, originalname, mimetype }
   * @returns {{ tenant, admin, temporaryPassword }}
   *
   * When executesServices is false the single organization client (with its default branch and
   * service, no logo) is created atomically with the tenant and its admin, and stored in
   * tenant.organizationCustomerId.
   */
  static async createWithAdmin(payload, logoFile = null) {
    const { tenant: tenantInput, admin: adminData } = payload;
    const { type: tenantLevelType, capabilities: tenantLevelCapabilities, ...tenantData } = tenantInput;
    const capabilities = resolveCapabilitiesInput({
      type: payload.type ?? tenantLevelType,
      capabilities: payload.capabilities ?? tenantLevelCapabilities,
    });

    // Validate everything the organization client needs BEFORE touching the DB or Firebase.
    const contactName = `${adminData.firstName} ${adminData.lastName}`.trim();
    let organization = null;
    if (!capabilities.executesServices) {
      buildOrganizationCustomerData(tenantData, contactName);
      organization = { customerId: new mongoose.Types.ObjectId(), contactName };
    }

    // Fast-fail: tenantId uniqueness check before touching the DB in a loop
    const existing = await Tenant.findOne({ tenantId: tenantData.tenantId })
      .setOptions({ includeDeleted: true })
      .lean();
    if (existing) {
      throw new ApiError(409, `El tenant '${tenantData.tenantId}' ya existe`, 'TENANT_EXISTS');
    }

    const temporaryPassword = generateTemporaryPassword();

    const tenantPayload = { ...tenantData, status: 'active', capabilities };
    if (organization) tenantPayload.organizationCustomerId = organization.customerId;

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
      let createdAdminRole;

      await session.withTransaction(async () => {
        [createdTenant] = await Tenant.create([tenantPayload], { session });
        // Ensure tenantId is consistent with what was persisted (lowercase enforced by schema)
        adminPayload.tenantId = createdTenant.tenantId;
        // Bootstrap the tenant's "Admin" role with the full permission catalog.
        // isSystem=true blocks accidental delete/rename of the tenant's
        // last admin role from the Roles UI.
        [createdAdminRole] = await Role.create(
          [{
            tenantId: createdTenant.tenantId,
            name: 'Admin',
            description: 'Tenant administrator (bootstrap)',
            permissions: PERMISSION_VALUES,
            isSystem: true,
          }],
          { session },
        );
        adminPayload.roleId = createdAdminRole._id;
        [createdAdmin] = await User.create([adminPayload], { session });
        if (organization) {
          await PlatformTenantService._createOrganizationClient(
            { ...tenantPayload, tenantId: createdTenant.tenantId },
            organization.contactName,
            session,
            organization.customerId,
          );
        }
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
          organization,
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
  static async _createWithAdminCompensatory(tenantPayload, adminPayload, temporaryPassword, organization = null) {
    let createdTenant;
    try {
      createdTenant = await Tenant.create(tenantPayload);
    } catch (err) {
      throw err; // tenant creation itself failed — nothing to compensate
    }

    try {
      // Bootstrap the tenant's "Admin" role (isSystem=true) before the user
      // so the resulting user carries a valid roleId, mirroring the transactional path.
      const createdAdminRole = await Role.create({
        tenantId: createdTenant.tenantId,
        name: 'Admin',
        description: 'Tenant administrator (bootstrap)',
        permissions: PERMISSION_VALUES,
        isSystem: true,
      });
      const createdAdmin = await User.create({
        ...adminPayload,
        tenantId: createdTenant.tenantId,
        roleId: createdAdminRole._id,
      });
      if (organization) {
        // Creates customer, branch and service; on its own failure it soft-deletes what it created.
        await PlatformTenantService._createOrganizationClient(
          { ...tenantPayload, tenantId: createdTenant.tenantId },
          organization.contactName,
          null,
          organization.customerId,
        );
      }
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
      // Compensate: soft-delete the orphaned tenant and the bootstrap role and admin created for it.
      // The tenant was created seconds ago in this very call, so everything under its tenantId is ours.
      await Tenant.updateOne(
        { _id: createdTenant._id },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );
      for (const Model of [User, Role]) {
        try {
          await Model.updateMany(
            { tenantId: createdTenant.tenantId },
            { $set: { isDeleted: true, deletedAt: new Date() } },
          );
        } catch (cleanupErr) {
          logger.error('PlatformTenantService: compensation failed', { model: Model.modelName, error: cleanupErr.message });
        }
      }
      throw userErr;
    }
  }

  /**
   * Creates the organization client of a tenant that does not execute services: the Customer built
   * from the tenant data (no logo), its default Sede "Principal" and default Servicio "Principal".
   * It does NOT reuse customerService.create (no session support, and it starts with the same
   * failure-prone branch creation).
   *
   * With a session every write joins the transaction. Without one (standalone MongoDB) a failure
   * soft-deletes whatever was already created before rethrowing, so no orphan remains.
   *
   * @param {object} tenant        tenant data (tenantId, name, nit, ciudad, departamento, email, telefono, direccion)
   * @param {string} contactName
   * @param {object|null} session
   * @param {ObjectId} [customerId] pre-generated _id (so the tenant can reference it in a single insert)
   * @returns {Promise<{ customer, sede, servicio }>}
   * @private
   */
  static async _createOrganizationClient(tenant, contactName, session = null, customerId = undefined) {
    const customerData = buildOrganizationCustomerData(tenant, contactName);
    if (customerId) customerData._id = customerId;

    const created = [];
    try {
      const customer = await createDoc(Customer, customerData, session);
      created.push([Customer, customer._id]);

      const sede = await createDoc(
        Sedes,
        {
          tenantId: tenant.tenantId,
          Cliente: customer._id,
          nombreSede: 'Principal',
          contact: customerData.UserContacto,
          departamento: customerData.Departamento,
          ciudad: customerData.Ciudad,
          direccion: customerData.Direccion || '',
          telefono: customerData.TelContacto,
          email: customerData.Email,
        },
        session,
      );
      created.push([Sedes, sede._id]);

      const servicio = await createDoc(
        Servicios,
        {
          tenantId: tenant.tenantId,
          Cliente: customer._id,
          sedeId: sede._id,
          nombre: 'Principal',
          observacion: 'Servicio creado por defecto al crear el cliente',
        },
        session,
      );
      created.push([Servicios, servicio._id]);

      return { customer, sede, servicio };
    } catch (err) {
      if (!session) await softDeleteCreated(created);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // CAPABILITIES
  // ---------------------------------------------------------------------------

  /**
   * Changes the capability flags of a tenant (PATCH /platform/tenants/:id/capabilities).
   *
   * Input: { type } preset OR { executesServices?, registersExternal? } merged over the stored
   * values, plus optional organizationCustomerId. At least one resulting flag must be true.
   *
   * When the result has executesServices=false the tenant must end with ONE organization client:
   *   - organizationCustomerId given: it must be a client of the tenant (400 otherwise);
   *   - the tenant already references a valid one: it is kept;
   *   - no client: it is created from the tenant data (branch + service, no logo);
   *   - exactly one client: it is referenced;
   *   - several: 409 ORGANIZATION_CUSTOMER_REQUIRED with the candidates.
   * Nothing is ever deleted or reassigned.
   *
   * @param {string} id        MongoDB ObjectId of the tenant
   * @param {object} input     validated body
   * @param {string} [actorId] SuperAdmin userId (logging; the audit entry is written by auditPlatformAction)
   */
  static async updateCapabilities(id, input = {}, actorId = null) {
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
    const tenant = await Tenant.findById(id).setOptions({ includeDeleted: true }).lean();
    if (!tenant) throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');

    const before = normalizeCapabilities(tenant.capabilities);
    const next = resolveCapabilitiesInput(input, before);
    const requestedOrgId = input.organizationCustomerId ? String(input.organizationCustomerId) : null;

    if (requestedOrgId && next.executesServices) {
      throw new ApiError(
        400,
        'El cliente de la organización solo aplica cuando el tenant no ejecuta servicios',
        'ORGANIZATION_CUSTOMER_NOT_APPLICABLE',
      );
    }

    let organizationCustomerId = tenant.organizationCustomerId ? String(tenant.organizationCustomerId) : null;
    let customerToCreate = null; // { customerId, contactName }

    if (!next.executesServices) {
      const isClientOfTenant = async (customerId) => Boolean(
        customerId &&
          (await Customer.findOne({
            _id: customerId,
            tenantId: tenant.tenantId,
            kind: { $ne: 'provider' },
            isDeleted: false,
          }).lean()),
      );

      if (requestedOrgId) {
        if (!(await isClientOfTenant(requestedOrgId))) {
          throw new ApiError(
            400,
            'El cliente elegido no pertenece a este tenant o no es un cliente',
            'INVALID_ORGANIZATION_CUSTOMER',
          );
        }
        organizationCustomerId = requestedOrgId;
      } else if (!(await isClientOfTenant(organizationCustomerId))) {
        const clients = await Customer.find({
          tenantId: tenant.tenantId,
          kind: { $ne: 'provider' },
          isDeleted: false,
        })
          .select('_id Razonsocial Nit')
          .lean();

        if (clients.length > 1) {
          throw new ApiError(
            409,
            'El tenant tiene varios clientes: elige cuál es el cliente de la organización',
            'ORGANIZATION_CUSTOMER_REQUIRED',
            { candidates: clients.map((c) => ({ _id: String(c._id), Razonsocial: c.Razonsocial, Nit: c.Nit })) },
          );
        }
        if (clients.length === 1) {
          organizationCustomerId = String(clients[0]._id);
        } else {
          // None: build it from the tenant data. Validate first so nothing is written when incomplete.
          const admin = await User.findOne({ tenantId: tenant.tenantId, role: 'admin', isDeleted: false })
            .sort({ createdAt: 1 })
            .select('firstName lastName')
            .lean();
          const contactName = admin ? `${admin.firstName || ''} ${admin.lastName || ''}`.trim() : '';
          buildOrganizationCustomerData(tenant, contactName);
          customerToCreate = { customerId: new mongoose.Types.ObjectId(), contactName };
          organizationCustomerId = String(customerToCreate.customerId);
        }
      }
    }

    const $set = { capabilities: next };
    if (!next.executesServices) $set.organizationCustomerId = organizationCustomerId;

    const apply = async (session) => {
      let createdDocs = null;
      if (customerToCreate) {
        createdDocs = await PlatformTenantService._createOrganizationClient(
          tenant,
          customerToCreate.contactName,
          session,
          customerToCreate.customerId,
        );
      }
      try {
        const query = Tenant.findByIdAndUpdate(id, { $set }, session ? { new: true, session } : { new: true });
        return await query.setOptions({ includeDeleted: true }).lean();
      } catch (err) {
        if (!session && createdDocs) {
          await softDeleteCreated([
            [Customer, createdDocs.customer._id],
            [Sedes, createdDocs.sede._id],
            [Servicios, createdDocs.servicio._id],
          ]);
        }
        throw err;
      }
    };

    let updated;
    if (!customerToCreate) {
      updated = await apply(null);
    } else {
      let session;
      try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => { updated = await apply(session); });
      } catch (txErr) {
        if (!isTransactionUnsupportedError(txErr)) throw txErr;
        logger.warn('PlatformTenantService.updateCapabilities: transactions unsupported, using compensatory flow');
        updated = await apply(null);
      } finally {
        if (session) {
          try { await session.endSession(); } catch (_) { /* best-effort */ }
        }
      }
    }

    const after = normalizeCapabilities(updated.capabilities);
    logger.info('PlatformTenantService.updateCapabilities: capabilities changed', {
      tenantId: tenant.tenantId,
      actorId,
      before,
      after,
      organizationCustomerCreated: Boolean(customerToCreate),
    });

    return {
      tenantId: updated.tenantId ?? tenant.tenantId,
      capabilities: after,
      type: getTenantType(after),
      organizationCustomerId: updated.organizationCustomerId ? String(updated.organizationCustomerId) : null,
      organizationCustomerCreated: Boolean(customerToCreate),
    };
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
