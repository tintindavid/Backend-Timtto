/**
 * tests/integration/sheetworkCloseReports.routes.test.js
 *
 * DB-free "integration" tests for
 * POST /api/v1/sheetworks/:sheetId/close-reports (sheet-report-closure
 * spec). Mocks the Mongoose model statics at the DB boundary; drives
 * controller -> service directly (no supertest in this repo — same
 * convention as tests/integration/clientPortalSign.routes.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { TICKET_STATUS } from '../../src/constants/ticket.constants.js';
import { sheetWorkController } from '../../src/controllers/sheetwork.controller.js';

function buildRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const SHEET_ID = '507f1f77bcf86cd799439030';
const OT_ID = '507f1f77bcf86cd799439010';
const R1 = '507f1f77bcf86cd799439021'; // Procesado
const R2 = '507f1f77bcf86cd799439022'; // Procesado
const R3 = '507f1f77bcf86cd799439023'; // Cancelado — must stay untouched
const TICKET_ID = '507f1f77bcf86cd799439077';

describe('POST /api/v1/sheetworks/:sheetId/close-reports', () => {
  afterEach(() => {
    delete SheetWork.findOne;
    delete Report.updateMany;
    delete Report.countDocuments;
    delete Report.find;
    delete OT.findOneAndUpdate;
    delete Ticket.findOne;
  });

  it('closes only the Procesado reports of the target sheet; Cancelado reports of the same sheet stay untouched', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT_A, otId: OT_ID }) });

    let updateManyFilter = null;
    let updateManyPipeline = null;
    Report.updateMany = async (filter, update) => {
      updateManyFilter = filter;
      updateManyPipeline = update;
      // Simulate the DB: only R1/R2 (estado: 'Procesado') match the filter.
      return { matchedCount: 2, modifiedCount: 2 };
    };
    Report.countDocuments = async () => 2; // total === closed after this call
    OT.findOneAndUpdate = async () => ({});
    // `.select().lean()` feeds the closed-report-ids fetch; the bare
    // `.lean()` feeds triggerTicketCascadeOnClose's own re-query (reused
    // Report.find mock) — no ticket-linked reports in this fixture.
    Report.find = () => ({
      select: () => ({ lean: () => Promise.resolve([{ _id: R1 }, { _id: R2 }]) }),
      lean: () => Promise.resolve([]),
    });

    const req = { params: { sheetId: SHEET_ID }, tenantId: TENANT_A };
    const res = buildRes();
    await sheetWorkController.closeReports(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.modifiedCount, 2);

    assert.equal(updateManyFilter.hojaDeTrabajo, SHEET_ID);
    assert.equal(updateManyFilter.estado, 'Procesado');
    assert.equal(updateManyFilter.tenantId, TENANT_A);
    assert.ok(Array.isArray(updateManyPipeline), 'must be a pipeline update ($ifNull for fechaFinalizdo)');
    assert.equal(updateManyPipeline[0].$set.estado, 'Cerrado');
    assert.ok(updateManyPipeline[0].$set.fechaFinalizdo?.$ifNull);
    // R3 (Cancelado) is never referenced by the filter — the `estado:
    // 'Procesado'` clause alone guarantees it and reports of other sheets
    // are excluded from the update.
  });

  it('does not modify reports of a different sheet (hojaDeTrabajo scoping)', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT_A, otId: OT_ID }) });
    let capturedFilter = null;
    Report.updateMany = async (filter) => {
      capturedFilter = filter;
      return { matchedCount: 1, modifiedCount: 1 };
    };
    Report.countDocuments = async () => 1;
    OT.findOneAndUpdate = async () => ({});
    Report.find = () => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) });

    const req = { params: { sheetId: SHEET_ID }, tenantId: TENANT_A };
    await sheetWorkController.closeReports(req, buildRes(), (err) => { if (err) throw err; });

    assert.equal(capturedFilter.hojaDeTrabajo, SHEET_ID, 'only reports of THIS sheet are targeted');
  });

  it('404 SHEET_NOT_FOUND for a cross-tenant sheet id; no reports modified', async () => {
    let findOneFilter = null;
    SheetWork.findOne = (filter) => { findOneFilter = filter; return { lean: () => Promise.resolve(null) }; };
    let updateManyCalled = false;
    Report.updateMany = async () => { updateManyCalled = true; return { matchedCount: 0, modifiedCount: 0 }; };

    const req = { params: { sheetId: SHEET_ID }, tenantId: TENANT_B };
    let capturedErr = null;
    await sheetWorkController.closeReports(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
    assert.equal(findOneFilter.tenantId, TENANT_B);
    assert.equal(updateManyCalled, false, 'no report update must run when the sheet is not found');
  });

  it('recomputes OT.Avance/EstadoOt for the sheet\'s OT', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT_A, otId: OT_ID }) });
    Report.updateMany = async () => ({ matchedCount: 2, modifiedCount: 2 });
    Report.countDocuments = async (filter) => (filter.estado === 'Cerrado' ? 2 : 2); // 100% closed
    const otUpdateCalls = [];
    OT.findOneAndUpdate = async (filter, update) => { otUpdateCalls.push({ filter, update }); return {}; };
    Report.find = () => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) });

    const req = { params: { sheetId: SHEET_ID }, tenantId: TENANT_A };
    await sheetWorkController.closeReports(req, buildRes(), (err) => { if (err) throw err; });

    assert.equal(otUpdateCalls.length, 1);
    assert.equal(otUpdateCalls[0].filter._id, OT_ID);
    assert.equal(otUpdateCalls[0].update.$set.Avance, 100);
    assert.equal(otUpdateCalls[0].update.$set.EstadoOt, 'Cerrado');
  });

  it('dispatches the ticket-closure cascade for the reports it closed', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT_A, otId: OT_ID }) });
    Report.updateMany = async () => ({ matchedCount: 1, modifiedCount: 1 });
    Report.countDocuments = async () => 1;
    OT.findOneAndUpdate = async () => ({});
    // First Report.find call (closed-report ids fetch) -> then
    // triggerTicketCascadeOnClose calls Report.find again (reused mock).
    Report.find = () => ({
      select: () => ({ lean: () => Promise.resolve([{ _id: R1 }]) }),
      lean: () => Promise.resolve([
        { _id: R1, tenantId: TENANT_A, isFromTicket: true, ticket: TICKET_ID, estado: 'Cerrado' },
      ]),
    });

    const ticketDoc = {
      _id: TICKET_ID,
      tenantId: TENANT_A,
      status: TICKET_STATUS.PENDIENTE,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      save: async function save() { this.saved = true; },
      toJSON() { return { ...this }; },
    };
    Ticket.findOne = () => ticketDoc;

    const req = { params: { sheetId: SHEET_ID }, tenantId: TENANT_A };
    await sheetWorkController.closeReports(req, buildRes(), (err) => { if (err) throw err; });

    assert.equal(ticketDoc.status, TICKET_STATUS.CERRADO);
    assert.equal(ticketDoc.saved, true);
  });
});
