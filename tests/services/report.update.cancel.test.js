/**
 * Cancelling a report from the panel PUTs back the whole loaded report, where
 * `ClienteId` is populated. The update must accept it (no CUSTOMER_NOT_FOUND)
 * and persist `Cancelado` with the plain customer id.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { reportService } from '../../src/services/report.service.js';
import { Report } from '../../src/models/report.model.js';
import { Customer } from '../../src/models/customer.model.js';

const T = 'tenant-a';
const ID = '507f1f77bcf86cd799439099';
const CLIENT = '507f1f77bcf86cd799439055';
const lean = (v) => ({ lean: () => Promise.resolve(v) });

describe('reportService.update — cancel with a populated ClienteId', () => {
  afterEach(() => {
    delete Report.findById; delete Report.findByIdAndUpdate; delete Customer.findOne;
  });

  it('keeps the same client (populated object) without re-validating it and saves Cancelado', async () => {
    const writes = [];
    Report.findById = () => lean({ _id: ID, tenantId: T, estado: 'Abierto', ClienteId: CLIENT });
    Report.findByIdAndUpdate = async (...a) => { writes.push(a); return { _id: ID, estado: 'Cancelado' }; };
    Customer.findOne = () => { throw new Error('customer lookup must not run for an unchanged client'); };

    await reportService.update(ID, {
      estado: 'Cancelado',
      motivoCancelacion: 'Equipo fuera de servicio',
      ClienteId: { _id: CLIENT, Razonsocial: 'ACME' },
    }, T);

    const set = writes[0][1].$set;
    assert.equal(set.estado, 'Cancelado');
    assert.equal(set.ClienteId, CLIENT);
  });
});
