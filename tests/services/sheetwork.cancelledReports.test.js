/**
 * A report cancelled by the user must stay `Cancelado` when it is linked to a
 * worksheet (create / sign-in-place), and must still count as "resolved" when
 * recomputing the OT progress. DB-free: Report/OT statics are monkey-patched.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { sheetWorkService } from '../../src/services/sheetwork.service.js';
import { CLOSE_UNLESS_CANCELLED_EXPR, REPORT_RESOLVED_STATES } from '../../src/constants/report.constants.js';

const TENANT = 'tenant-a';
const OT_ID = '507f1f77bcf86cd799439010';
const SHEET_ID = '507f1f77bcf86cd799439030';

/** Evaluates the `$cond` expression the way MongoDB would for a given estado. */
function evalClose(expr, estado) {
  const [cond, thenV, elseV] = expr.$cond;
  assert.deepEqual(cond, { $eq: ['$estado', 'Cancelado'] });
  return estado === 'Cancelado' ? thenV : elseV;
}

describe('cancelled reports in worksheets', () => {
  const orig = {};
  afterEach(() => {
    Object.assign(Report, orig.Report || {});
    Object.assign(OT, orig.OT || {});
    Object.assign(SheetWork, orig.SheetWork || {});
  });

  it('close expression keeps Cancelado and closes everything else', () => {
    assert.equal(evalClose(CLOSE_UNLESS_CANCELLED_EXPR, 'Cancelado'), 'Cancelado');
    for (const e of ['Pendiente', 'Abierto', 'En Progreso', 'Procesado', 'Cerrado']) {
      assert.equal(evalClose(CLOSE_UNLESS_CANCELLED_EXPR, e), 'Cerrado');
    }
  });

  it('Cancelado counts as resolved for OT progress', () => {
    assert.deepEqual(REPORT_RESOLVED_STATES, ['Cerrado', 'Cancelado']);
  });

  it('_finalizeSignedSheet uses the cancelled-preserving expression and counts Cancelado as resolved', async () => {
    orig.Report = { updateMany: Report.updateMany, find: Report.find, countDocuments: Report.countDocuments };
    orig.OT = { findOneAndUpdate: OT.findOneAndUpdate, findOne: OT.findOne };
    let update = null;
    const countFilters = [];
    Report.updateMany = async (_f, u) => { update = u; return {}; };
    Report.find = () => ({ select: () => ({ lean: async () => [] }), lean: async () => [] });
    Report.countDocuments = async (f) => { countFilters.push(f); return 1; };
    let otSet = null;
    OT.findOneAndUpdate = async (_f, u) => { otSet = u.$set; return {}; };
    OT.findOne = () => ({ select: () => ({ lean: async () => null }) });

    await sheetWorkService._finalizeSignedSheet(
      { _id: SHEET_ID, otId: OT_ID, reports: ['507f1f77bcf86cd799439001'] },
      TENANT,
    ).catch(() => {});

    assert.ok(Array.isArray(update), 'pipeline update expected');
    assert.deepEqual(update[0].$set.estado, CLOSE_UNLESS_CANCELLED_EXPR);
    assert.deepEqual(countFilters[1].estado, { $in: REPORT_RESOLVED_STATES });
    assert.equal(otSet.EstadoOt, 'Cerrado');
  });
});
