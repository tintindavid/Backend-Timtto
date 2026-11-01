/**
 * requisiciones-datos-por-defecto-tenant, 4.3: the superadmin triggers the seed of the Requisiciones defaults on the
 * false -> true transition of usesRequisiciones (PATCH capabilities) and when a tenant is created with the module.
 * DB-free: Mongoose statics and mongoose.startSession are stubbed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { PlatformTenantService } from '../../src/services/platformTenant.service.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { emailService } from '../../src/services/external/email.service.js';
import { stubModel } from '../helpers/memoryModel.js';

const MONGO_ID = '507f1f77bcf86cd799439011';
const chain = (value) => {
  const q = { select: () => q, sort: () => q, setOptions: () => q, session: () => q, lean: () => Promise.resolve(value), then: (res, rej) => Promise.resolve(value).then(res, rej) };
  return q;
};
const CAPS_OFF = { executesServices: true, registersExternal: false, usesRequisiciones: false, managesCustomers: true };

let tipos; let areas; let reglas; let presupuestos; let restores; let saved; let tenant;

beforeEach(() => {
  tipos = []; areas = []; reglas = []; presupuestos = [];
  restores = [stubModel(TipoRequisicion, tipos), stubModel(Area, areas), stubModel(ReglaAprobacion, reglas), stubModel(PresupuestoArea, presupuestos)];
  saved = {
    findById: Tenant.findById, findByIdAndUpdate: Tenant.findByIdAndUpdate, findOne: Tenant.findOne, create: Tenant.create,
    roleCreate: Role.create, userCreate: User.create, startSession: mongoose.startSession, email: emailService.sendWelcomeEmail,
  };
  tenant = { _id: MONGO_ID, tenantId: 'acme', name: 'Acme', status: 'active', capabilities: CAPS_OFF, organizationCustomerId: null };
  Tenant.findOne = () => chain(null);
  Tenant.findById = () => chain(tenant);
  Tenant.findByIdAndUpdate = (_id, update) => { tenant = { ...tenant, ...update.$set }; return chain(tenant); };
  emailService.sendWelcomeEmail = async () => ({ sent: false });
});

afterEach(() => {
  restores.forEach((r) => r());
  Object.assign(Tenant, { findById: saved.findById, findByIdAndUpdate: saved.findByIdAndUpdate, findOne: saved.findOne, create: saved.create });
  Role.create = saved.roleCreate; User.create = saved.userCreate;
  mongoose.startSession = saved.startSession; emailService.sendWelcomeEmail = saved.email;
});

const total = () => tipos.length + areas.length + reglas.length + presupuestos.length;

describe('updateCapabilities seeds the defaults', () => {
  it('seeds on false -> true and reports the summary', async () => {
    const out = await PlatformTenantService.updateCapabilities(MONGO_ID, { usesRequisiciones: true }, 'actor1');
    assert.deepEqual(out.requisicionesDefaults, { tipos: 8, areas: 7, regla: 1, presupuesto: 1, adoptados: 0 });
    assert.equal(out.capabilities.usesRequisiciones, true);
    assert.ok([...tipos, ...areas, ...reglas, ...presupuestos].every((d) => d.tenantId === 'acme'));
  });

  it('turning it off keeps the data; turning it on again does not duplicate', async () => {
    await PlatformTenantService.updateCapabilities(MONGO_ID, { usesRequisiciones: true }, 'actor1');
    const count = total();
    const off = await PlatformTenantService.updateCapabilities(MONGO_ID, { usesRequisiciones: false }, 'actor1');
    assert.equal(off.requisicionesDefaults, undefined);
    assert.equal(total(), count);
    const on = await PlatformTenantService.updateCapabilities(MONGO_ID, { usesRequisiciones: true }, 'actor1');
    assert.deepEqual(on.requisicionesDefaults, { tipos: 0, areas: 0, regla: 0, presupuesto: 0, adoptados: 0 });
    assert.equal(total(), count);
  });

  it('another capability change, or the flag already on, does not seed', async () => {
    const other = await PlatformTenantService.updateCapabilities(MONGO_ID, { usesQrs: true }, 'actor1');
    assert.equal(other.requisicionesDefaults, undefined);
    tenant = { ...tenant, capabilities: { ...CAPS_OFF, usesRequisiciones: true } };
    const again = await PlatformTenantService.updateCapabilities(MONGO_ID, { usesRequisiciones: true, usesQrs: true }, 'actor1');
    assert.equal(again.requisicionesDefaults, undefined);
    assert.equal(total(), 0);
  });

  it('a seed failure does not revert the capabilities and returns { error: true }', async () => {
    TipoRequisicion.find = () => { throw new Error('db down'); };
    const out = await PlatformTenantService.updateCapabilities(MONGO_ID, { usesRequisiciones: true }, 'actor1');
    assert.deepEqual(out.requisicionesDefaults, { error: true });
    assert.equal(out.capabilities.usesRequisiciones, true);
    assert.equal(tenant.capabilities.usesRequisiciones, true);
  });
});

describe('createWithAdmin seeds the defaults', () => {
  const input = (usesRequisiciones) => ({
    capabilities: { executesServices: true, registersExternal: false, usesRequisiciones, managesCustomers: true },
    tenant: { tenantId: 'newco', name: 'Newco', nit: '900123456-7', ciudad: 'Bogota', departamento: 'Cundinamarca', email: 'a@newco.com', telefono: '6011234567', direccion: 'Calle 1' },
    admin: { email: 'admin@newco.com', firstName: 'Ana', lastName: 'Perez' },
  });
  const made = (doc) => ({ _id: '1'.padEnd(24, '0'), ...doc, toJSON() { return { ...this, toJSON: undefined }; } });

  beforeEach(() => {
    Tenant.findOne = () => chain(null);
    Tenant.create = async (doc) => (Array.isArray(doc) ? [made(doc[0])] : made(doc));
    Role.create = async (doc) => (Array.isArray(doc) ? [made(doc[0])] : made(doc));
    User.create = async (doc) => (Array.isArray(doc) ? [made(doc[0])] : made(doc));
  });

  for (const mode of ['transaction', 'compensating']) {
    it(`seeds when born with the module (${mode} path) and not otherwise`, async () => {
      mongoose.startSession = async () => ({
        withTransaction: async (fn) => {
          if (mode === 'compensating') throw Object.assign(new Error('Transaction numbers are only allowed on a replica set member or mongos'), { code: 20 });
          return fn();
        },
        endSession: async () => {},
      });
      const none = await PlatformTenantService.createWithAdmin(input(false));
      assert.equal(none.requisicionesDefaults, undefined);
      assert.equal(total(), 0);
      const out = await PlatformTenantService.createWithAdmin(input(true));
      assert.deepEqual(out.requisicionesDefaults, { tipos: 8, areas: 7, regla: 1, presupuesto: 1, adoptados: 0 });
      assert.ok(tipos.every((t) => t.tenantId === 'newco'));
    });
  }

  it('a seed failure at creation keeps the tenant and reports { error: true }', async () => {
    mongoose.startSession = async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} });
    Area.find = () => { throw new Error('boom'); };
    const out = await PlatformTenantService.createWithAdmin(input(true));
    assert.deepEqual(out.requisicionesDefaults, { error: true });
    assert.equal(out.tenant.tenantId, 'newco');
  });
});
