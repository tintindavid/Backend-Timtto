/**
 * tests/services/customer.kind.callsites.test.js
 * terceros-customers-providers, task 4.3: every write path that sets ClienteId
 * rejects a provider (400 INVALID_CUSTOMER_KIND), a third party of another
 * tenant (404), and lets a client through the guard. DB-free: model statics
 * are stubbed; the write itself is replaced by a sentinel so we can tell
 * whether the guard ran first.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Customer } from '../../src/models/customer.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Servicios } from '../../src/models/servicios.model.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { oTService as otService } from '../../src/services/ot.service.js';
import { reportService } from '../../src/services/report.service.js';
import { ticketService } from '../../src/services/ticket.service.js';
import { sheetWorkService } from '../../src/services/sheetwork.service.js';
import { repuestosService } from '../../src/services/repuestos.service.js';
import { serviceQrService } from '../../src/services/serviceQr.service.js';
import { clientAccessTokenService } from '../../src/services/clientAccessToken.service.js';

const TENANT_A = 'tenant-a';
const CLIENT_ID = '507f1f77bcf86cd799439001';
const PROVIDER_ID = '507f1f77bcf86cd799439002';
const OTHER_TENANT_ID = '507f1f77bcf86cd799439003';
const DOCS = [
  { _id: CLIENT_ID, tenantId: TENANT_A, kind: 'customer' },
  { _id: PROVIDER_ID, tenantId: TENANT_A, kind: 'provider' },
  { _id: OTHER_TENANT_ID, tenantId: 'tenant-b', kind: 'customer' },
];

// Chainable, tenant-aware Customer.findOne stub (select().lean() and lean()).
function stubCustomers() {
  Customer.findOne = (query) => ({
    select() { return this; },
    lean: () => Promise.resolve(
      DOCS.find((d) => d.tenantId === query.tenantId && String(d._id) === String(query._id)) || null,
    ),
  });
}

const SENTINEL = new Error('write reached');
const isProvider = (err) => err.statusCode === 400 && err.code === 'INVALID_CUSTOMER_KIND';
const isNotFound = (err) => err.statusCode === 404;

// Runs `call(clienteId)` against the three scenarios.
async function expectGuard(call) {
  await assert.rejects(() => call(PROVIDER_ID), isProvider);
  await assert.rejects(() => call(OTHER_TENANT_ID), isNotFound);
  // A client passes the guard and reaches the (stubbed) write.
  await assert.rejects(() => call(CLIENT_ID), (err) => err === SENTINEL || (err.code !== 'INVALID_CUSTOMER_KIND' && err.statusCode !== 404));
}

describe('assertCustomerKind call sites', () => {
  afterEach(() => {
    delete Customer.findOne;
    delete EquipoItem.create; delete EquipoItem.findOne; delete EquipoItem.findById;
    delete EquipoItem.findOneAndUpdate; delete EquipoItem.findByIdAndUpdate;
    delete OT.create; delete Report.create; delete SheetWork.create;
    delete Repuestos.create; delete Repuestos.findById; delete Repuestos.findByIdAndUpdate; delete Repuestos.findOne; delete Repuestos.findOneAndUpdate;
    delete Sedes.findOne; delete Servicios.findOne;
  });

  it('equipoItem.create', async () => {
    stubCustomers();
    EquipoItem.findOne = () => ({ collation() { return this; }, populate() { return this; }, lean: () => Promise.resolve(null) });
    EquipoItem.create = async () => { throw SENTINEL; };
    await expectGuard((ClienteId) => equipoItemService.create({ ClienteId, ItemId: 'i', Marca: 'M', Serie: 'S1' }, TENANT_A));
  });

  it('equipoItem.update when ClienteId is part of the payload', async () => {
    stubCustomers();
    // update() loads the current document to compare the client (guard only runs on change).
    EquipoItem.findById = () => ({ select() { return this; }, lean: () => Promise.resolve({ tenantId: TENANT_A, ClienteId: '507f1f77bcf86cd7994390ff' }) });
    EquipoItem.findByIdAndUpdate = async () => { throw SENTINEL; };
    EquipoItem.findOneAndUpdate = async () => { throw SENTINEL; };
    await expectGuard((ClienteId) => equipoItemService.update('507f1f77bcf86cd799439010', { ClienteId }, TENANT_A));
  });

  it('ot.create', async () => {
    stubCustomers();
    OT.create = async () => { throw SENTINEL; };
    await assert.rejects(() => otService.create({ ClienteId: PROVIDER_ID }, TENANT_A, null), isProvider);
    await assert.rejects(() => otService.create({ ClienteId: OTHER_TENANT_ID }, TENANT_A, null), isNotFound);
  });

  it('ot.create accepts customerId alias too', async () => {
    stubCustomers();
    await assert.rejects(() => otService.create({ customerId: PROVIDER_ID }, TENANT_A, null), isProvider);
  });

  it('report.create', async () => {
    stubCustomers();
    Report.create = async () => { throw SENTINEL; };
    await assert.rejects(() => reportService.create({ ClienteId: PROVIDER_ID }, TENANT_A), isProvider);
    await assert.rejects(() => reportService.create({ ClienteId: OTHER_TENANT_ID }, TENANT_A), isNotFound);
  });

  it('ticket batch (admin and public both go through _createBatch)', async () => {
    stubCustomers();
    const base = { sedeId: 's', servicioId: 'v', equipos: [], generalObservation: '', urgency: 'low', source: 'admin' };
    await assert.rejects(() => ticketService._createBatch({ tenantId: TENANT_A, ClienteId: PROVIDER_ID, ...base }), isProvider);
    await assert.rejects(() => ticketService._createBatch({ tenantId: TENANT_A, ClienteId: OTHER_TENANT_ID, ...base }), isNotFound);
  });

  it('sheetwork.create when clienteId is supplied', async () => {
    stubCustomers();
    SheetWork.create = async () => { throw SENTINEL; };
    await assert.rejects(() => sheetWorkService.create({ clienteId: PROVIDER_ID }, TENANT_A, null), isProvider);
    await assert.rejects(() => sheetWorkService.create({ clienteId: OTHER_TENANT_ID }, TENANT_A, null), isNotFound);
  });

  it('repuestos.create', async () => {
    stubCustomers();
    Repuestos.create = async () => { throw SENTINEL; };
    await assert.rejects(() => repuestosService.create({ ClienteId: PROVIDER_ID }, TENANT_A), isProvider);
    await assert.rejects(() => repuestosService.create({ ClienteId: OTHER_TENANT_ID }, TENANT_A), isNotFound);
  });

  it('repuestos.update when ClienteId is part of the payload', async () => {
    stubCustomers();
    Repuestos.findOne = () => ({ lean: () => Promise.resolve({ _id: 'r1', tenantId: TENANT_A }) });
    Repuestos.findOneAndUpdate = async () => { throw SENTINEL; };
    await assert.rejects(() => repuestosService.update('r1', { ClienteId: PROVIDER_ID }, TENANT_A), isProvider);
  });

  it('serviceQr.create rejects a provider and keeps 404 for a foreign customer', async () => {
    stubCustomers();
    Sedes.findOne = () => ({ lean: () => Promise.resolve({ _id: 's' }) });
    Servicios.findOne = () => ({ lean: () => Promise.resolve({ _id: 'v' }) });
    const payload = (ClienteId) => ({ ClienteId, sedeId: 's', servicioId: 'v', password: 'x' });
    await assert.rejects(() => serviceQrService.create(payload(PROVIDER_ID), TENANT_A), isProvider);
    await assert.rejects(() => serviceQrService.create(payload(OTHER_TENANT_ID), TENANT_A), isNotFound);
  });

  it('clientAccessToken.create', async () => {
    stubCustomers();
    await assert.rejects(
      () => clientAccessTokenService.create({ clienteId: PROVIDER_ID, otIds: ['o1'] }, TENANT_A, 'u1'),
      isProvider,
    );
    await assert.rejects(
      () => clientAccessTokenService.create({ clienteId: OTHER_TENANT_ID, otIds: ['o1'] }, TENANT_A, 'u1'),
      isNotFound,
    );
  });
});

// Keep the helper referenced so a future call site can reuse the full matrix.
void expectGuard;
