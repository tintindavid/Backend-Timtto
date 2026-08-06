/**
 * tests/utils/ticketCascade.util.test.js
 *
 * DB-free tests for the shared ticket-closure cascade (design D2,
 * portal-signature-flow). Mocks the Mongoose model statics at the DB
 * boundary — no supertest/mongodb-memory-server in this repo (same
 * convention as tests/integration/clientPortalSign.routes.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Report } from '../../src/models/report.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { TICKET_STATUS } from '../../src/constants/ticket.constants.js';
import { triggerTicketCascadeOnClose } from '../../src/utils/ticketCascade.util.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const REPORT_ID = '507f1f77bcf86cd799439021';
const TICKET_ID = '507f1f77bcf86cd799439099';

function ticketDoc(overrides = {}) {
  return {
    _id: TICKET_ID,
    tenantId: TENANT_A,
    status: TICKET_STATUS.PENDIENTE,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    save: async function save() { this.saved = true; },
    toJSON() { return { ...this }; },
    ...overrides,
  };
}

describe('triggerTicketCascadeOnClose', () => {
  afterEach(() => {
    delete Report.find;
    delete Ticket.findOne;
  });

  it('closes the ticket when a linked report transitions to Cerrado (!closed -> closed)', async () => {
    Report.find = () => ({
      lean: () => Promise.resolve([
        {
          _id: REPORT_ID,
          tenantId: TENANT_A,
          isFromTicket: true,
          ticket: TICKET_ID,
          estado: 'Cerrado',
          observacion: 'Trabajo completado',
        },
      ]),
    });

    const ticket = ticketDoc({ status: TICKET_STATUS.PENDIENTE });
    Ticket.findOne = () => ticket;

    await triggerTicketCascadeOnClose([REPORT_ID], TENANT_A);

    assert.equal(ticket.status, TICKET_STATUS.CERRADO);
    assert.equal(ticket.saved, true);
  });

  it('is a no-op (no write) when the linked ticket is already cerrado', async () => {
    Report.find = () => ({
      lean: () => Promise.resolve([
        {
          _id: REPORT_ID,
          tenantId: TENANT_A,
          isFromTicket: true,
          ticket: TICKET_ID,
          estado: 'Cerrado',
        },
      ]),
    });

    const ticket = ticketDoc({ status: TICKET_STATUS.CERRADO, saved: false });
    Ticket.findOne = () => ticket;

    await triggerTicketCascadeOnClose([REPORT_ID], TENANT_A);

    assert.equal(ticket.status, TICKET_STATUS.CERRADO);
    assert.equal(ticket.saved, false, 'save() must not be called when the ticket is already cerrado');
  });

  it('tenant isolation: only queries reports scoped to the given tenantId', async () => {
    let capturedFilter = null;
    Report.find = (filter) => {
      capturedFilter = filter;
      return { lean: () => Promise.resolve([]) };
    };
    Ticket.findOne = () => {
      throw new Error('Ticket.findOne must not be called — no reports matched for this tenant');
    };

    await triggerTicketCascadeOnClose([REPORT_ID], TENANT_B);

    assert.equal(capturedFilter.tenantId, TENANT_B);
    assert.notEqual(capturedFilter.tenantId, TENANT_A);
  });
});
