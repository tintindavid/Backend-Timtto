/**
 * "Mantenimiento propio": OT creation / update with managesCustomers=false. DB-free (statics stubbed).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { oTService } from '../../src/services/ot.service.js';
import { OT } from '../../src/models/ot.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { History } from '../../src/models/history.model.js';

const TENANT = 'clinic';
const ORG = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const OWN = { capabilities: { executesServices: true, registersExternal: false, managesCustomers: false }, organizationCustomerId: ORG };
const MANAGING = { capabilities: { executesServices: true, registersExternal: false, managesCustomers: true }, organizationCustomerId: null };
const BODY = { TipoServicio: 'Preventivo', OtPrioridad: 'Media' };

describe('oTService with managesCustomers=false', () => {
  const saved = {};
  let created;
  let envSaved;

  beforeEach(() => {
    envSaved = process.env.ENFORCE_TENANT_CAPABILITIES;
    delete process.env.ENFORCE_TENANT_CAPABILITIES;
    Object.assign(saved, {
      otCreate: OT.create, custFindOne: Customer.findOne, counter: Counter.findOneAndUpdate, hist: History.create,
      startSession: OT.startSession, otFindOne: OT.findOne,
    });
    created = [];
    OT.create = async (d) => { created.push(d); return { _id: 'ot1', ...d, save: async () => {} }; };
    Customer.findOne = () => ({ select: () => ({ lean: async () => ({ _id: ORG, kind: 'customer' }) }) });
    Counter.findOneAndUpdate = () => ({ lean: async () => ({ seq: 1 }) });
    History.create = async () => ({});
  });

  afterEach(() => {
    OT.create = saved.otCreate; Customer.findOne = saved.custFindOne; Counter.findOneAndUpdate = saved.counter;
    History.create = saved.hist; OT.startSession = saved.startSession; OT.findOne = saved.otFindOne;
    if (envSaved === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = envSaved;
  });

  it('create without ClienteId fills the organization customer', async () => {
    await oTService.create({ ...BODY }, TENANT, null, OWN);
    assert.equal(created.length, 1);
    assert.equal(String(created[0].ClienteId), ORG);
  });

  it('create with the organization customer is accepted', async () => {
    await oTService.create({ ...BODY, ClienteId: ORG }, TENANT, null, OWN);
    assert.equal(created.length, 1);
  });

  it('create with a foreign ClienteId is 403 CLIENTE_NO_PERMITIDO and nothing is stored', async () => {
    await assert.rejects(
      () => oTService.create({ ...BODY, ClienteId: OTHER }, TENANT, null, OWN),
      (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO',
    );
    assert.equal(created.length, 0);
  });

  it('a managing tenant still needs ClienteId (400) and keeps the one it sends', async () => {
    await assert.rejects(() => oTService.create({ ...BODY }, TENANT, null, MANAGING), (e) => e.statusCode === 400);
    await oTService.create({ ...BODY, ClienteId: OTHER }, TENANT, null, MANAGING);
    assert.equal(String(created[0].ClienteId), OTHER);
  });

  it('update rejects switching to a foreign client', async () => {
    OT.startSession = async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} });
    OT.findOne = () => ({ session: async () => ({ _id: 'ot1', ClienteId: OTHER, EstadoOt: 'Pendiente' }) });
    await assert.rejects(
      () => oTService.update('ot1', { ClienteId: '507f1f77bcf86cd799439033' }, TENANT, null, OWN),
      (e) => e.statusCode === 403 && e.code === 'CLIENTE_NO_PERMITIDO',
    );
  });
});
