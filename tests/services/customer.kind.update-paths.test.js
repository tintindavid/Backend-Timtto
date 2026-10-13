/**
 * tests/services/customer.kind.update-paths.test.js
 * terceros-customers-providers (adversarial review fixes): Report.update and the
 * HVEquipo create/update paths reject a provider as client, and update paths only
 * validate when the client actually changes (so editing a record whose client was
 * soft-deleted later keeps working). DB-free: model statics are stubbed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Customer } from '../../src/models/customer.model.js';
import { Report } from '../../src/models/report.model.js';
import { HVEquipo } from '../../src/models/hvequipo.model.js';
import { reportService } from '../../src/services/report.service.js';
import { hVEquipoService } from '../../src/services/hvequipo.service.js';
import { assertCustomerKindIfChanged } from '../../src/utils/assertCustomerKind.util.js';

const TENANT = 'tenant-a';
const CLIENT_ID = '507f1f77bcf86cd799439001';
const OTHER_CLIENT_ID = '507f1f77bcf86cd799439004';
const PROVIDER_ID = '507f1f77bcf86cd799439002';
const FOREIGN_ID = '507f1f77bcf86cd799439003';
const REPORT_ID = '507f1f77bcf86cd799439010';
const HV_ID = '507f1f77bcf86cd799439011';

const DOCS = [
  { _id: CLIENT_ID, tenantId: TENANT, kind: 'customer' },
  { _id: OTHER_CLIENT_ID, tenantId: TENANT, kind: 'customer' },
  { _id: PROVIDER_ID, tenantId: TENANT, kind: 'provider' },
  { _id: FOREIGN_ID, tenantId: 'tenant-b', kind: 'customer' },
];
let customerLookups;

function stubCustomers() {
  customerLookups = 0;
  Customer.findOne = (query) => {
    customerLookups += 1;
    return {
      select() { return this; },
      lean: () => Promise.resolve(
        DOCS.find((d) => d.tenantId === query.tenantId && String(d._id) === String(query._id)) || null,
      ),
    };
  };
}

const SENTINEL = new Error('write reached');
const isProvider = (e) => e.statusCode === 400 && e.code === 'INVALID_CUSTOMER_KIND';
const isNotFound = (e) => e.statusCode === 404;
const reachedWrite = (e) => e === SENTINEL || e.cause === SENTINEL || e.message === SENTINEL.message;

afterEach(() => {
  delete Customer.findOne;
  delete Report.findById; delete Report.findByIdAndUpdate;
  delete HVEquipo.create; delete HVEquipo.findOne; delete HVEquipo.findOneAndUpdate;
});

describe('assertCustomerKindIfChanged', () => {
  it('skips the lookup when the client is unchanged (even if it was deleted later)', async () => {
    stubCustomers();
    assert.equal(await assertCustomerKindIfChanged(CLIENT_ID, CLIENT_ID, TENANT), null);
    assert.equal(customerLookups, 0);
  });

  it('validates when the client changes', async () => {
    stubCustomers();
    await assert.rejects(() => assertCustomerKindIfChanged(PROVIDER_ID, CLIENT_ID, TENANT), isProvider);
    await assert.rejects(() => assertCustomerKindIfChanged(FOREIGN_ID, CLIENT_ID, TENANT), isNotFound);
    const ok = await assertCustomerKindIfChanged(OTHER_CLIENT_ID, CLIENT_ID, TENANT);
    assert.equal(String(ok._id), OTHER_CLIENT_ID);
  });

  it('validates when there is no current client and ignores a missing id', async () => {
    stubCustomers();
    await assert.rejects(() => assertCustomerKindIfChanged(PROVIDER_ID, undefined, TENANT), isProvider);
    assert.equal(await assertCustomerKindIfChanged(undefined, CLIENT_ID, TENANT), null);
  });
});

describe('Report.update guard', () => {
  const stubReport = (currentClient = CLIENT_ID) => {
    Report.findById = () => ({ lean: () => Promise.resolve({ _id: REPORT_ID, tenantId: TENANT, ClienteId: currentClient }) });
    Report.findByIdAndUpdate = () => Promise.reject(SENTINEL);
  };

  it('rejects a provider as ClienteId (PUT/PATCH /reports/:id)', async () => {
    stubCustomers(); stubReport();
    await assert.rejects(() => reportService.update(REPORT_ID, { ClienteId: PROVIDER_ID }, TENANT), isProvider);
  });

  it('rejects a client of another tenant with 404', async () => {
    stubCustomers(); stubReport();
    await assert.rejects(() => reportService.update(REPORT_ID, { ClienteId: FOREIGN_ID }, TENANT), isNotFound);
  });

  it('lets a client through to the write, and skips the lookup when unchanged', async () => {
    stubCustomers(); stubReport();
    await assert.rejects(() => reportService.update(REPORT_ID, { ClienteId: OTHER_CLIENT_ID }, TENANT), (e) => !isProvider(e) && !isNotFound(e));
    assert.equal(customerLookups, 1);
    customerLookups = 0;
    await assert.rejects(() => reportService.update(REPORT_ID, { ClienteId: CLIENT_ID }, TENANT), (e) => !isProvider(e) && !isNotFound(e));
    assert.equal(customerLookups, 0);
  });
});

describe('HVEquipo create/update guard', () => {
  it('rejects a provider as clienteId on create', async () => {
    stubCustomers();
    HVEquipo.create = () => Promise.reject(SENTINEL);
    await assert.rejects(() => hVEquipoService.create({ clienteId: PROVIDER_ID }, TENANT), isProvider);
    await assert.rejects(() => hVEquipoService.create({ clienteId: FOREIGN_ID }, TENANT), isNotFound);
  });

  it('lets a client reach the create write', async () => {
    stubCustomers();
    HVEquipo.create = () => Promise.reject(SENTINEL);
    await assert.rejects(() => hVEquipoService.create({ clienteId: CLIENT_ID }, TENANT), (e) => !isProvider(e) && !isNotFound(e));
  });

  it('rejects a provider as clienteId on update', async () => {
    stubCustomers();
    HVEquipo.findOne = () => ({ select() { return this; }, lean: () => Promise.resolve({ clienteId: CLIENT_ID }) });
    HVEquipo.findOneAndUpdate = () => Promise.reject(SENTINEL);
    await assert.rejects(() => hVEquipoService.update(HV_ID, { clienteId: PROVIDER_ID }, TENANT), isProvider);
  });

  it('does not look the client up on update when it is unchanged (HV page resends clienteId on every save)', async () => {
    stubCustomers();
    HVEquipo.findOne = () => ({ select() { return this; }, lean: () => Promise.resolve({ clienteId: CLIENT_ID }) });
    HVEquipo.findOneAndUpdate = () => Promise.reject(SENTINEL);
    await assert.rejects(() => hVEquipoService.update(HV_ID, { clienteId: CLIENT_ID }, TENANT), (e) => !isProvider(e) && !isNotFound(e));
    assert.equal(customerLookups, 0);
  });
});
