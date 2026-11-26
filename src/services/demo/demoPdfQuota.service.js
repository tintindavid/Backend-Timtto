import { DemoPdfUsage } from '../../models/demoPdfUsage.model.js';
import { ApiError } from '../../utils/apiError.util.js';
import { requireTenant } from '../../utils/tenant.util.js';
import { getDemoConfig } from './demoContext.service.js';
import { DEMO_LIMITS } from '../../constants/demo.constants.js';

/**
 * Reserves one of the report places of a work order. Returns 'held' if the report already had it, 'new' if it was just
 * taken and null when the order has no places left.
 */
async function takeSlot(key, reportId, limit) {
  const filter = { ...key, $or: [{ reportIds: reportId }, { [`reportIds.${limit - 1}`]: { $exists: false } }] };
  const update = { $addToSet: { reportIds: reportId } };
  let before;
  try {
    before = await DemoPdfUsage.findOneAndUpdate(filter, update, { upsert: true, new: false });
  } catch (err) {
    // E11000: the order already has its document, either full or just created by a concurrent request.
    if (err?.code !== 11000) throw err;
    before = await DemoPdfUsage.findOneAndUpdate(filter, update, { new: false });
    if (!before) return null;
  }
  return before?.reportIds?.includes(reportId) ? 'held' : 'new';
}

/**
 * Runs `generate` with the service reports that may be downloaded. A demo account can only download a few distinct
 * reports of each work order, whatever the route (single or ZIP): the ones already downloaded keep their place and the
 * free places go to the first ones by consecutive. Places taken are freed if `generate` fails. Outside a demo account
 * every report is passed through.
 */
export async function withDemoReportSlots(tenantId, reports, generate) {
  requireTenant(tenantId);
  const demo = await getDemoConfig(tenantId);
  if (!demo || !reports.length) return generate(reports);

  // Demo accounts created before this limit existed have no stored value.
  const limit = demo.limits.reportsPerOt ?? DEMO_LIMITS.reportsPerOt;
  const order = (r) => String(r.consecutivo || r._id);
  const allowed = [];
  const taken = [];
  try {
    for (const report of [...reports].sort((a, b) => order(a).localeCompare(order(b)))) {
      const docId = String(report.orden?._id ?? report.orden ?? 'sin-ot').toLowerCase();
      const key = { tenantId, docType: 'otReports', docId };
      const reportId = String(report._id).toLowerCase();
      const slot = await takeSlot(key, reportId, limit);
      if (!slot) continue;
      allowed.push(report);
      if (slot === 'new') taken.push({ key, reportId });
    }
    if (!allowed.length) {
      throw new ApiError(
        403,
        `En las cuentas de demostración solo se pueden descargar ${limit} reportes de cada orden de trabajo`,
        'DEMO_PDF_LIMIT_REACHED',
        { docType: 'otReports', limit },
      );
    }
    return await generate(allowed);
  } catch (err) {
    for (const { key, reportId } of taken) await DemoPdfUsage.updateOne(key, { $pull: { reportIds: reportId } });
    throw err;
  }
}

/** Atomically takes one download of a document; false when none is left. */
async function takeOne(key, limit) {
  const filter = { ...key, used: { $lt: limit } };
  const update = { $inc: { used: 1 } };
  try {
    return Boolean(await DemoPdfUsage.findOneAndUpdate(filter, update, { upsert: true, new: true }));
  } catch (err) {
    // E11000: the document exists, either exhausted or just created by a concurrent request.
    if (err?.code !== 11000) throw err;
    return Boolean(await DemoPdfUsage.findOneAndUpdate(filter, update, { new: true }));
  }
}

const giveBack = (key) => DemoPdfUsage.updateOne({ ...key, used: { $gt: 0 } }, { $inc: { used: -1 } });

/**
 * Runs `generate` consuming one download of every document in a demo account. Nothing is consumed when a document has
 * no downloads left or when `generate` fails. Outside a demo account it just runs `generate`.
 */
export async function withDemoPdfQuota(tenantId, docType, docIds, generate) {
  requireTenant(tenantId);
  const demo = await getDemoConfig(tenantId);
  if (!demo) return generate();

  const limit = demo.limits.pdfPerDocument;
  const taken = [];
  try {
    // ObjectIds are case-insensitive: every spelling of an id shares the same counter.
    for (const docId of new Set(docIds.map((d) => String(d).toLowerCase()))) {
      const key = { tenantId, docType, docId };
      if (!(await takeOne(key, limit))) {
        throw new ApiError(
          403,
          `En las cuentas de demostración cada documento se puede descargar ${limit} veces`,
          'DEMO_PDF_LIMIT_REACHED',
          { docType, docId, limit },
        );
      }
      taken.push(key);
    }
    return await generate();
  } catch (err) {
    for (const key of taken) await giveBack(key);
    throw err;
  }
}
