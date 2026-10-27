/**
 * "Mantenimiento propio" (managesCustomers=false) against a REAL MongoDB. SKIPPED unless MONGO_INTEGRATION_URI is
 * set, so `npm test` never needs a database. Throwaway standalone mongod only; the test creates and DROPS its own
 * database `own_it_<random>`.
 *
 *   mongod --dbpath <new empty dir> --port 27556 --bind_ip 127.0.0.1
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27556 node --test tests/integration/ownCustomer.mongo.integration.test.js
 *
 * NEVER point it at a shared / remote / production database.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Customer } from '../../src/models/customer.model.js';
import { OT } from '../../src/models/ot.model.js';
import { oTService } from '../../src/services/ot.service.js';
import { customerService } from '../../src/services/customer.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);

describe('mantenimiento propio against a real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const tenantId = `own-${rnd()}`;
  const dbName = `own_it_${rnd()}`;
  let org;
  let foreign;
  let ctx;

  before(async () => {
    await mongoose.connect(URI, { dbName });
    org = await Customer.create({
      tenantId, kind: 'customer', Razonsocial: 'Clinica Propia', Nit: 900123, Ciudad: 'Bogota', Departamento: 'Cundinamarca',
      Email: 'c@clinica.co', TelContacto: '3001112233', UserContacto: 'Ana Perez',
    });
    foreign = await Customer.create({
      tenantId, kind: 'customer', Razonsocial: 'Otro Cliente', Nit: 800321, Ciudad: 'Cali', Departamento: 'Valle',
      Email: 'o@otro.co', TelContacto: '3004445566', UserContacto: 'Luis Gomez',
    });
    ctx = {
      capabilities: { executesServices: true, registersExternal: false, managesCustomers: false },
      organizationCustomerId: String(org._id),
    };
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  const body = (extra = {}) => ({ TipoServicio: 'Preventivo', OtPrioridad: 'Media', ...extra });

  it('POST /ots without ClienteId stores the organization customer', async () => {
    const created = await oTService.create(body(), tenantId, { userId: null, userName: 'it' }, ctx);
    const stored = await OT.findById(created._id).lean();
    assert.equal(String(stored.ClienteId), String(org._id));
    assert.equal(stored.tenantId, tenantId);
  });

  it('a foreign ClienteId is 403 CLIENTE_NO_PERMITIDO and no OT is stored', async () => {
    const before = await OT.countDocuments({ tenantId });
    await assert.rejects(
      () => oTService.create(body({ ClienteId: String(foreign._id) }), tenantId, null, ctx),
      (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO',
    );
    assert.equal(await OT.countDocuments({ tenantId }), before);
  });

  it('customer writes are 403 CAPABILITY_DISABLED; reads of existing customers still work', async () => {
    await assert.rejects(
      () => customerService.create({ Razonsocial: 'Nuevo', Ciudad: 'x', Departamento: 'y', Email: 'n@n.co', Nit: 1, TelContacto: '1', UserContacto: 'z' }, tenantId, null, ctx.capabilities),
      (e) => e.statusCode === 403 && e.code === 'CAPABILITY_DISABLED',
    );
    await assert.rejects(() => customerService.delete(String(foreign._id), tenantId, ctx.capabilities), (e) => e.code === 'CAPABILITY_DISABLED');
    const list = await customerService.list({}, { page: 1, limit: 10 }, tenantId);
    assert.equal(list.data.length, 2);
    const got = await customerService.getById(String(foreign._id), tenantId);
    assert.equal(got.Razonsocial, 'Otro Cliente');
  });

  it('EXPLOIT: PUT {isDeleted:true} / tenantId / kind on the organization customer is denied and nothing is written', async () => {
    const opts = { organizationCustomerId: String(org._id) };
    for (const body of [{ isDeleted: true }, { deletedAt: new Date() }, { tenantId: 'other-tenant' }, { Ciudad: 'Cali', isDeleted: true }]) {
      await assert.rejects(
        () => customerService.update(String(org._id), { ...body }, tenantId, null, ctx.capabilities, opts),
        (e) => e.statusCode === 400 && e.code === 'VALIDATION_ERROR',
      );
    }
    // kind is dropped silently (immutable) and the legitimate field is applied
    await customerService.update(String(org._id), { kind: 'provider', Direccion: 'Calle 9' }, tenantId, null, ctx.capabilities, opts);
    const stored = await Customer.collection.findOne({ _id: org._id });
    assert.equal(stored.isDeleted, false);
    assert.equal(stored.tenantId, tenantId);
    assert.equal(stored.kind, 'customer');
    assert.equal(stored.Ciudad, 'Bogota', 'the rejected payloads wrote nothing');
    assert.equal(stored.Direccion, 'Calle 9');
  });

  it('regression: a normal edit of the organization customer still works (multipart-like strings)', async () => {
    const body = Object.assign(Object.create(null), { Razonsocial: 'Clinica Propia SAS', Nit: '900124', Email: 'x@clinica.co', Ciudad: 'Medellin' });
    const updated = await customerService.update(String(org._id), body, tenantId, null, ctx.capabilities, { organizationCustomerId: String(org._id) });
    assert.equal(updated.Razonsocial, 'Clinica Propia SAS');
    assert.equal(updated.Nit, 900124);
    assert.equal(updated.Ciudad, 'Medellin');
  });
});
