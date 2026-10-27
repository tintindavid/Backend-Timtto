/**
 * Adversarial fix (managesCustomers #2/#3): the "mantenimiento propio" scope also applies to the OTs created from
 * tickets (/tickets/work-order) and from repuestos requests (/repuestos/ot-from-solicitudes), and in
 * ENFORCE_TENANT_CAPABILITIES warn/off the missing ClienteId is still filled. DB-free (model statics stubbed).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ticketService } from '../../src/services/ticket.service.js';
import { repuestosService } from '../../src/services/repuestos.service.js';
import { applyOwnCustomerOnCreate, assertOwnCustomerOnUpdate } from '../../src/utils/ownCustomerScope.util.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { User } from '../../src/models/user.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { notificationService } from '../../src/services/notification.service.js';

const TENANT = 'clinic';
const ORG = '507f1f77bcf86cd799439002';
const OTHER = '507f1f77bcf86cd799439003';
const RESP = '507f1f77bcf86cd799439011';
const CTX = {
  capabilities: { executesServices: true, registersExternal: false, managesCustomers: false },
  organizationCustomerId: ORG,
};
const MANAGING_CTX = { capabilities: { executesServices: true, managesCustomers: true }, organizationCustomerId: ORG };
const START = new Date(Date.now() + 86400000).toISOString();
const END = new Date(Date.now() + 3 * 86400000).toISOString();

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
const savedMode = process.env.ENFORCE_TENANT_CAPABILITIES;

afterEach(() => {
  while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; }
  if (savedMode === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
  else process.env.ENFORCE_TENANT_CAPABILITIES = savedMode;
});

describe('createWorkOrder (tickets) under the own-customer scope', () => {
  const ticket = (ClienteId) => ({
    _id: 't1', ClienteId, status: 'pendiente', workOrderId: null, equipoId: 'e1', tenantId: TENANT,
    createdAt: new Date(), firstResponseAt: new Date(),
  });

  function stubTickets(ClienteId) {
    const state = { claimed: false, ot: null };
    stub(User, 'findOne', () => ({ lean: async () => ({ _id: RESP }) }));
    stub(Ticket, 'find', () => ({ lean: async () => [ticket(ClienteId)] }));
    stub(Ticket, 'updateMany', async () => { state.claimed = true; return { modifiedCount: 1 }; });
    stub(Ticket, 'updateOne', async () => ({}));
    stub(Counter, 'findOneAndUpdate', () => ({ lean: async () => ({ seq: 1 }) }));
    stub(OT, 'create', async (d) => { state.ot = d; return { ...d, save: async () => {}, toJSON() { return d; } }; });
    stub(Report, 'insertMany', async (docs) => docs.map((d, i) => ({ ...d, _id: `r${i}`, ticket: d.ticket })));
    return state;
  }

  it('a ticket of another customer is 403 CLIENTE_NO_PERMITIDO and nothing is claimed or created', async () => {
    const state = stubTickets(OTHER);
    await assert.rejects(
      () => ticketService.createWorkOrder({ ticketIds: ['t1'], responsableId: RESP }, TENANT, {}, CTX),
      (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO',
    );
    assert.equal(state.claimed, false);
    assert.equal(state.ot, null);
  });

  it('a ticket of the organization customer creates the OT with that customer', async () => {
    const state = stubTickets(ORG);
    await ticketService.createWorkOrder({ ticketIds: ['t1'], responsableId: RESP }, TENANT, {}, CTX);
    assert.equal(String(state.ot.ClienteId), ORG);
  });

  it('managing tenants and callers without tenant context keep the source client', async () => {
    let state = stubTickets(OTHER);
    await ticketService.createWorkOrder({ ticketIds: ['t1'], responsableId: RESP }, TENANT, {}, MANAGING_CTX);
    assert.equal(String(state.ot.ClienteId), OTHER);
    state = stubTickets(OTHER);
    await ticketService.createWorkOrder({ ticketIds: ['t1'], responsableId: RESP }, TENANT, {});
    assert.equal(String(state.ot.ClienteId), OTHER);
  });
});

describe('createOtFromSolicitudes (repuestos) under the own-customer scope', () => {
  function stubRepuestos(repuestos) {
    const state = { ot: null };
    stub(Repuestos, 'find', () => ({ lean: async () => repuestos }));
    stub(Repuestos, 'updateMany', async () => ({ modifiedCount: repuestos.length }));
    stub(OT, 'create', async (d) => { state.ot = d; return { _id: 'ot1', ...d, reportes: [], save: async () => {} }; });
    stub(Report, 'create', async () => ({ _id: 'rep1' }));
    stub(Report, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
    stub(EquipoItem, 'findOne', (f) => {
      assert.equal(f.tenantId, TENANT, 'equipment lookup is tenant-filtered');
      return { populate() { return this; }, lean: async () => ({ _id: f._id, Marca: 'M' }) };
    });
    stub(Counter, 'findOneAndUpdate', () => ({ lean: async () => ({ seq: 1 }) }));
    stub(RepuestoTrazabilidad, 'create', async () => ({}));
    stub(User, 'find', () => ({
      populate: () => ({ lean: async () => [{ _id: RESP, firstName: 'T', lastName: 'U', roleId: { permissions: ['ots:can-be-responsible'] } }] }),
    }));
    stub(Customer, 'findById', () => ({ select: () => ({ lean: async () => ({ Razonsocial: 'X' }) }) }));
    stub(notificationService, 'emit', async () => ({}));
    return state;
  }
  const rep = (extra = {}) => ({ _id: 'r1', tenantId: TENANT, EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ...extra });
  const call = (ctx) => repuestosService.createOtFromSolicitudes(
    { repuestoIds: ['r1'], responsableUserIds: [RESP], fechaInicio: START, fechaFin: END }, TENANT, { userId: 'a' }, ctx);

  it('a request of another customer is 403 CLIENTE_NO_PERMITIDO and no OT is created', async () => {
    const state = stubRepuestos([rep({ ClienteId: OTHER })]);
    await assert.rejects(() => call(CTX), (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO');
    assert.equal(state.ot, null);
  });

  it('a request without client is filled with the organization customer', async () => {
    const state = stubRepuestos([rep()]);
    await call(CTX);
    assert.equal(String(state.ot.ClienteId), ORG);
  });

  it('a request of the organization customer works; managing tenants keep the source client', async () => {
    let state = stubRepuestos([rep({ ClienteId: ORG })]);
    await call(CTX);
    assert.equal(String(state.ot.ClienteId), ORG);
    state = stubRepuestos([rep({ ClienteId: OTHER })]);
    await call(MANAGING_CTX);
    assert.equal(String(state.ot.ClienteId), OTHER);
  });
});

describe('ENFORCE_TENANT_CAPABILITIES warn/off still fills the missing ClienteId', () => {
  for (const mode of ['warn', 'off']) {
    it(`${mode}: absent ClienteId is filled, a foreign one is not rejected`, () => {
      process.env.ENFORCE_TENANT_CAPABILITIES = mode;
      assert.equal(applyOwnCustomerOnCreate(CTX, {}).ClienteId, ORG);
      assert.equal(applyOwnCustomerOnCreate(CTX, { ClienteId: '' }).ClienteId, ORG);
      assert.equal(applyOwnCustomerOnCreate(CTX, { ClienteId: OTHER }).ClienteId, OTHER);
      assert.doesNotThrow(() => assertOwnCustomerOnUpdate(CTX, OTHER, null));
    });
  }

  it('warn: a scoped tenant without organizationCustomerId is not rejected (the field is simply not filled)', () => {
    process.env.ENFORCE_TENANT_CAPABILITIES = 'warn';
    const data = applyOwnCustomerOnCreate({ capabilities: CTX.capabilities }, {});
    assert.equal(data.ClienteId, undefined);
  });

  it('on: foreign client is 403 and a missing org customer is 409', () => {
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    assert.throws(() => applyOwnCustomerOnCreate(CTX, { ClienteId: OTHER }), (e) => e.code === 'CLIENTE_NO_PERMITIDO');
    assert.throws(() => applyOwnCustomerOnCreate({ capabilities: CTX.capabilities }, {}), (e) => e.code === 'ORGANIZATION_CUSTOMER_MISSING');
  });
});
