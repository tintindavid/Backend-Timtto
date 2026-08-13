'use strict';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { Customer } from '../models/customer.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ClientAccessToken } from '../models/clientAccessToken.model.js';
import { SheetWork } from '../models/sheetwork.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import { computeSignedContentHash } from '../utils/contentHash.util.js';
import { getHTMLTemplate, generateHTMLFromReport } from '../utils/htmlTemplateGenerator.js';
import { triggerTicketCascadeOnClose } from '../utils/ticketCascade.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import SheetWorkPDFService from './sheetworkPDF.service.js';
import BulkPDFGenerator from './bulkPDFGenerator.js';
import { sheetWorkService } from './sheetwork.service.js';
import { logger } from '../config/logger.config.js';
import { SIGN_BATCH_ID_LENGTH } from '../constants/clientPortal.constants.js';

/**
 * ClientPortalService — read-only data shaping for the public client portal.
 *
 * Design D8 (revised after adversarial review): Report has NO `otId` back-ref;
 * the relation is `OT.reportes[]`. Historically autopopulate makes `.populate`
 * a natural fit, BUT `mongoose-autopopulate` runs a `pre('find')` hook that
 * calls `this.populate({ path: 'reportes' })` unconditionally after our
 * explicit populate — and Mongoose 8 OVERWRITES (not merges) options for the
 * same populated path, silently discarding our `match: { tenantId, ... }` and
 * `select: '...'`. Field leakage is still blocked by the whitelist mapper
 * `_summarizeReport`, but the tenant filter would be void.
 *
 * Fix: fetch OTs and their reports in TWO explicit queries with tenantId
 * filter on both. Bypasses autopopulate entirely.
 *
 * Design D9: every returned shape is built via an explicit whitelist so an
 * accidental new field on Report/OT never leaks into the public payload.
 */
export class ClientPortalService {
  constructor() {
    this.pdfService = new SheetWorkPDFService();
  }

  /**
   * Consolidated view: tenant identity, client name, and every OT in
   * `otIds` with its reports grouped underneath.
   */
  async getConsolidatedView(tenantId, clienteId, otIds) {
    requireTenant(tenantId);

    const [tenant, cliente, ots] = await Promise.all([
      Tenant.findOne({ tenantId }).select('name logoUrl').lean(),
      Customer.findOne(applyTenantFilter({ _id: clienteId }, tenantId))
        .select('Razonsocial')
        .lean(),
      OT.find(applyTenantFilter({ _id: { $in: otIds } }, tenantId))
        .select('Consecutivo EstadoOt Avance reportes')
        .lean(),
    ]);

    const allReportIds = (ots || []).flatMap((ot) => ot.reportes || []);
    // Explicit tenant filter here — the whitelist mapper below is the primary
    // field-leak defense, but this second-layer filter also ensures a
    // cross-tenant reportId that somehow ended up inside OT.reportes[] would
    // never be returned.
    const reports = allReportIds.length
      ? await Report.find({
          _id: { $in: allReportIds },
          tenantId,
          isDeleted: false,
        }).lean()
      : [];

    const reportsById = new Map(reports.map((r) => [String(r._id), r]));

    return {
      tenant: { name: tenant?.name || null, logoUrl: tenant?.logoUrl || null },
      cliente: { name: cliente?.Razonsocial || null },
      ots: (ots || []).map((ot) => ({
        _id: String(ot._id),
        Consecutivo: ot.Consecutivo,
        EstadoOt: ot.EstadoOt,
        Avance: ot.Avance,
        reports: (ot.reportes || [])
          .map((rid) => reportsById.get(String(rid)))
          .filter(Boolean)
          .map((r) => this._summarizeReport(r)),
      })),
    };
  }

  /**
   * Full detail of a single report, provided it belongs to one of the OTs
   * granted by the token AND its tenantId matches req.tenantId. Both checks
   * are enforced via the query filters (never post-fetch comparisons), so a
   * mismatch on either dimension yields the same 404 (no distinguishing info).
   */
  async getReportDetail(tenantId, otIds, reportId) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(reportId)) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const ot = await OT.findOne({
      _id: { $in: otIds },
      tenantId,
      reportes: reportId,
    })
      .select('_id')
      .lean();
    if (!ot) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const report = await Report.findOne({ _id: reportId, tenantId }).lean();
    if (!report) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    return this._detailReport(report);
  }

  /**
   * Renders the SAME HTML that the admin's `POST /api/v1/pdf-reports/single`
   * would send to the Puppeteer microservice to produce a single-report PDF.
   * Feeds an iframe on the client portal so the user sees the exact document
   * they will receive at handover (product decision: "no partes incompletas").
   *
   * Two portal-only enrichments happen BEFORE the template renders:
   *  1. Technician signature is synthesized from `token.createdBy` when the
   *     report has no `hojaDeTrabajo` yet (i.e. before the client signs).
   *     Otherwise the template would show "N/A" and the client would never
   *     see a real firma technician until after they signed — chicken/egg.
   *  2. The client-signature slot reflects the current review state:
   *     "Recibido a satisfacción el ..." once `clientReview.reviewedAt` is
   *     set. If already sheeted, the real `hojaDeTrabajo` data wins.
   *
   * Scope check is identical to `getReportDetail`. `escapeHtmlText` inside
   * the template handles user-supplied fields; the synthetic strings we add
   * here are either ISO dates or DB-controlled user fields (createdBy),
   * both safe to interpolate.
   */
  async getReportPdfViewHtml(tenantId, otIds, reportId, tokenId) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(reportId)) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const ot = await OT.findOne({
      _id: { $in: otIds },
      tenantId,
      reportes: reportId,
    })
      .select('_id')
      .lean();
    if (!ot) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const [report, tokenDoc] = await Promise.all([
      Report.findOne({ _id: reportId, tenantId })
        .populate('ClienteId')
        .populate({ path: 'Equipo', populate: { path: 'SedeId' } })
        .populate('ResponsableMtto', 'fullName role fileFirma')
        .populate('orden', 'Consecutivo TipoServicio')
        .populate(
          'hojaDeTrabajo',
          'personaRecibe cargoRecibe firmaResponsableFile firmaFile numeroHoja cargoResponsable fullNameResponsable'
        )
        .lean(),
      tokenId
        ? ClientAccessToken.findById(tokenId)
            .populate({ path: 'createdBy', select: 'fullName role fileFirma' })
            .populate({ path: 'attributionUserId', select: 'fullName role fileFirma' })
            .lean()
        : Promise.resolve(null),
    ]);

    if (!report) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const repuestos = await Repuestos.find({
      tenantId,
      $or: [{ ReporteSolicitudId: report._id }, { ReporteInstalacionId: report._id }],
    }).lean();

    const tenantData = await Tenant.findOne({ tenantId, isDeleted: false }).lean();

    // Synthesize a hojaDeTrabajo when there isn't a real one yet, so the
    // template's firma section renders a real técnico as signer and a status
    // line for the client slot instead of "N/A".
    //
    // Precedence for the técnico firma (2026-08-03):
    //  1. Report.ResponsableMtto (per-report técnico) when they have fileFirma
    //  2. Token.attributionUserId (immutable at token creation) when set
    //  3. Token.createdBy (legacy tokens predating attributionUserId)
    let hojaDeTrabajo = report.hojaDeTrabajo;
    if (!hojaDeTrabajo && tokenDoc) {
      const respMtto = report.ResponsableMtto;
      const attrib = tokenDoc.attributionUserId;
      const creator = tokenDoc.createdBy;
      const source = (respMtto && respMtto.fileFirma) ? respMtto
        : (attrib && attrib.fileFirma) ? attrib
        : creator;
      if (source) {
        const reviewed = report.clientReview?.reviewedAt
          ? new Date(report.clientReview.reviewedAt).toLocaleString('es-CO', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          : null;
        hojaDeTrabajo = {
          firmaResponsableFile: source.fileFirma || '',
          fullNameResponsable: source.fullName || 'N/A',
          cargoResponsable: source.role || 'Técnico',
          firmaFile: '',
          personaRecibe: reviewed ? 'Recibido a satisfacción' : '(pendiente de revisión)',
          cargoRecibe: reviewed ? reviewed : '',
        };
      }
    }

    const fullReport = { ...report, hojaDeTrabajo, repuestos };
    const html = generateHTMLFromReport(fullReport, tenantData || {}, getHTMLTemplate());
    // Portal-only visual shrink (2026-08-03 UX ask): the template base is 14px
    // and every rule is written in px, so a body font-size override wouldn't
    // cascade. `zoom: 0.857` (≈ -2px on the 14px base) scales every rendered
    // size uniformly. Injected AFTER the template renders so the actual PDF
    // pipeline (pdfReports.controller.js) is unaffected — clients still
    // receive the deliverable at the original size.
    return html.replace(
      '<head>',
      '<head><style>html{zoom:0.857}</style>'
    );
  }

  /** Summary shape for the consolidated (list) view — no evidences/activities. */
  _summarizeReport(r) {
    return {
      _id: String(r._id),
      consecutivo: r.consecutivo || null,
      estado: r.estado || null,
      equipoSnapshot: r.equipoSnapshot || null,
      fechaFinalizado: r.fechaFinalizdo || null,
      // Added 2026-08-04 for the portal list columns "estado operativo" +
      // "fecha del reporte". Both were already whitelisted on the detail
      // shape; promoting them to the summary avoids one extra request per
      // row just to render a badge and a date.
      fechaProcesado: r.fechaProcesado || null,
      estadoOperativo: r.estadoOperativo || r.EstadoOperativo || null,
      // Whitelist only `reviewedAt` — `reviewedByTokenId` is internal audit
      // data and must never reach the public payload (task 6.2).
      clientReview: r.clientReview?.reviewedAt ? { reviewedAt: r.clientReview.reviewedAt } : null,
      // Boolean derived from the presence of a hojaDeTrabajo ref — the actual
      // ObjectId is admin-only, but the frontend needs to disable the review
      // toggle once the report is in a signed sheet (adversarial Major: dead
      // UI gate was reading a field the API never exposed).
      isSheeted: Boolean(r.hojaDeTrabajo),
      // Free-form note the client attached from the portal. Whitelist the
      // text + updatedAt only; `updatedByTokenId` is audit-only.
      clientNote: r.clientNote?.text
        ? { text: r.clientNote.text, updatedAt: r.clientNote.updatedAt }
        : null,
    };
  }

  /** Full detail shape — excludes internal user ids and motivoCancelacion (D9). */
  _detailReport(r) {
    return {
      _id: String(r._id),
      consecutivo: r.consecutivo || null,
      estado: r.estado || null,
      equipoSnapshot: r.equipoSnapshot || null,
      // See _summarizeReport for the rationale on isSheeted / clientReview / clientNote.
      isSheeted: Boolean(r.hojaDeTrabajo),
      clientReview: r.clientReview?.reviewedAt ? { reviewedAt: r.clientReview.reviewedAt } : null,
      clientNote: r.clientNote?.text
        ? { text: r.clientNote.text, updatedAt: r.clientNote.updatedAt }
        : null,
      fechaCreacion: r.FechaCreacion || null,
      fechaFinalizado: r.fechaFinalizdo || null,
      fechaProcesado: r.fechaProcesado || null,
      fallaReportada: r.fallaReportada || null,
      diagnostico: r.diagnostico || null,
      accionTomada: r.accionTomada || null,
      observacion: r.observacion || null,
      observacionEstadoFinal: r.observacionEstadoFinal || null,
      estadoOperativo: r.estadoOperativo || r.EstadoOperativo || null,
      actividadesRealizadas: (r.actividadesRealizadas || []).map((a) => ({
        descripcion: a.descripcion,
        realizado: a.realizado,
        fecha: a.fecha,
        observaciones: a.observaciones,
      })),
      evidencias: (r.evidencias || []).map((e) => ({
        url: e.url,
        nombre: e.nombre,
        descripcion: e.descripcion,
        fechaSubida: e.fechaSubida,
      })),
      verificationParam: (r.verificationParam || []).map((v) => ({
        magnitud: v.magnitud,
        unidad: v.unidad,
        valorReferencia: v.valorReferencia,
        valorMedido: v.valorMedido,
        patron: v.patron,
      })),
    };
  }

  /**
   * Marks a report as reviewed by the client (design D2/D3, spec "Mark a
   * report as reviewed from the client portal"). Enforces OT membership,
   * eligible `estado`, and the not-yet-signed gate before writing.
   */
  async markReviewed(tenantId, otIds, reportId, tokenId) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(reportId)) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const report = await Report.findOne({ _id: reportId, tenantId }).lean();
    if (!report) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const ot = await OT.findOne({ _id: { $in: otIds }, tenantId, reportes: reportId })
      .select('_id')
      .lean();
    if (!ot) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    if (report.hojaDeTrabajo) {
      throw new ApiError(409, 'Este reporte ya fue firmado y no puede modificarse.', 'REPORT_ALREADY_SIGNED');
    }

    // Tightened 2026-08-02: only `Procesado` reports are reviewable. Admin
    // must promote Cerrado → Procesado first (mark-processed action). Cerrado
    // reports show up in the portal on their own read-only tab so the client
    // sees the pipeline, but no review/sign action is offered on them.
    if (report.estado !== 'Procesado') {
      throw new ApiError(409, 'Este reporte aún no puede marcarse como revisado.', 'REPORT_NOT_REVIEWABLE');
    }

    const updated = await Report.findByIdAndUpdate(
      reportId,
      { $set: { 'clientReview.reviewedAt': new Date(), 'clientReview.reviewedByTokenId': tokenId } },
      { new: true }
    ).lean();

    return { clientReview: { reviewedAt: updated.clientReview.reviewedAt } };
  }

  /**
   * Unmarks a report's review state (design D3). Locked once the report is
   * part of a signed SheetWork — undoing a review after signature would
   * rewrite the audit trail.
   */
  async unmarkReviewed(tenantId, otIds, reportId) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(reportId)) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const report = await Report.findOne({ _id: reportId, tenantId }).lean();
    if (!report) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const ot = await OT.findOne({ _id: { $in: otIds }, tenantId, reportes: reportId })
      .select('_id')
      .lean();
    if (!ot) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    if (report.hojaDeTrabajo) {
      throw new ApiError(409, 'Este reporte ya fue firmado y no puede modificarse.', 'REPORT_ALREADY_SIGNED');
    }

    await Report.findByIdAndUpdate(reportId, { $unset: { clientReview: '' } });
  }

  /**
   * Client-side note attached to a single report from the portal (2026-08-02).
   * Behaves like a per-report free-text field the client can add / edit /
   * clear at any time — even after signing — because clarifications like
   * "este equipo está fuera de servicio aunque el reporte lo marca operativo"
   * may only surface post-signature. Admin reads the note from an icon on
   * the OT's report list.
   *
   * Contract: `text === ''` (or null) → CLEAR the note (`$unset`). Otherwise
   * SET/OVERWRITE with the new text + updatedAt + updatedByTokenId. Length
   * is bounded by the caller (route DTO) rather than the schema, so a
   * config-time cap change doesn't require a migration.
   */
  async updateClientNote(tenantId, otIds, reportId, tokenId, rawText) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(reportId)) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const ot = await OT.findOne({ _id: { $in: otIds }, tenantId, reportes: reportId })
      .select('_id')
      .lean();
    if (!ot) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (text === '') {
      await Report.findByIdAndUpdate(reportId, { $unset: { clientNote: '' } });
      return { clientNote: null };
    }

    const now = new Date();
    const updated = await Report.findByIdAndUpdate(
      reportId,
      {
        $set: {
          'clientNote.text': text,
          'clientNote.updatedAt': now,
          'clientNote.updatedByTokenId': tokenId,
        },
      },
      { new: true }
    ).lean();
    return { clientNote: { text: updated.clientNote.text, updatedAt: updated.clientNote.updatedAt } };
  }

  /**
   * Signs the reviewed subset and creates one SheetWork per distinct OT
   * (design D6, "N HTs de un solo acto" with manual rollback — no replica
   * set / native multi-doc transactions in this deployment). PDF generation
   * is fired-and-forgotten (design D8) after a successful commit.
   *
   * @param {string} tenantId
   * @param {string} tokenId
   * @param {string[]} otIds
   * @param {{ reportIds: string[], signature: { imagePng, signerName, signerId, cargo? } }} body
   * @param {{ ip?: string, userAgent?: string }} meta
   */
  async signAndCreateSheets(tenantId, tokenId, otIds, body, meta = {}) {
    requireTenant(tenantId);

    const signedBatchId = nanoid(SIGN_BATCH_ID_LENGTH);
    logger.info('signAndCreateSheets: start', { signedBatchId, tenantId, tokenId });

    try {
      // 1. The attributed técnico must be able to sign (D5, updated 2026-08-03).
      // Precedence: attributionUserId when present (new tokens), else
      // createdBy (legacy tokens). The chosen user's firma is what stamps
      // every HT in this batch. Reason it is NOT per-report: SheetWork
      // carries a single top-level firma; splitting reports across
      // multiple sheets to honor per-report responsables is a follow-up.
      const token = await ClientAccessToken.findById(tokenId)
        .populate({ path: 'createdBy', select: 'fullName role fileFirma isDeleted' })
        .populate({ path: 'attributionUserId', select: 'fullName role fileFirma isDeleted' });
      const attributed = token?.attributionUserId || token?.createdBy;
      if (!attributed || attributed.isDeleted === true || !attributed.fileFirma) {
        throw new ApiError(
          409,
          'Este acceso no puede firmar HTs. Solicite un nuevo acceso al administrador.',
          'TOKEN_CREATOR_INVALID'
        );
      }
      const creator = attributed;

      // 2. Load reports scoped to this tenant. A count mismatch means some
      // reportIds are foreign (different tenant) or nonexistent — return the
      // same 404 that the read endpoints use, to keep the "no existence leak"
      // contract consistent (adversarial Minor: don't mislabel foreign IDs
      // as SIGN_REQUIRES_REVIEW).
      const reportIds = (body.reportIds || []).map(String);
      const reports = await Report.find({ _id: { $in: reportIds }, tenantId }).lean();
      if (reports.length !== reportIds.length) {
        throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
      }

      // 3. Every report must have been reviewed (D2).
      const unreviewedReportIds = reports
        .filter((r) => !r.clientReview?.reviewedAt)
        .map((r) => String(r._id));
      if (unreviewedReportIds.length) {
        throw new ApiError(
          400,
          'Algunos reportes no han sido revisados.',
          'SIGN_REQUIRES_REVIEW',
          { unreviewedReportIds }
        );
      }

      // 4. Group reportIds per OT covered by the token — same technique as
      // getReportDetail (query filter enforces membership, never a
      // post-fetch comparison).
      const ots = await OT.find({ _id: { $in: otIds }, tenantId, reportes: { $in: reportIds } })
        .select('_id Consecutivo reportes ClienteId')
        .lean();

      const reportIdSet = new Set(reportIds);
      const groups = ots
        .map((ot) => ({
          ot,
          reportsInGroup: (ot.reportes || []).map(String).filter((rid) => reportIdSet.has(rid)),
        }))
        .filter((g) => g.reportsInGroup.length > 0);

      const coveredReportIds = new Set(groups.flatMap((g) => g.reportsInGroup));
      if (coveredReportIds.size !== reportIds.length) {
        throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
      }

      // 5. Canonical content hash, shared across every sheet of this batch.
      const contentHash = computeSignedContentHash(reports);

      // 6. Persist the signature PNG (mirrors report.service.js's evidence
      // upload pattern — Firebase Storage, design D10 already validated the
      // decoded bytes + magic bytes at the DTO layer).
      const signatureBuffer = Buffer.from(body.signature.imagePng, 'base64');
      const { url: firmaFileUrl } = await firebaseStorageService.uploadEvidencia(
        signatureBuffer,
        `firma-${signedBatchId}.png`,
        'image/png',
        'client-portal/firmas'
      );

      // 7. Build one SheetWork per OT group. Uses the same numeroHoja
      // resolver as the on-site admin flow so portal-signed HTs get
      // `${OT.Consecutivo}-N` (e.g. `OT000029-2`) instead of the global
      // `HNNNN` fallback — previously produced inconsistent numbering
      // between the two flows for the same OT (2026-08-12 fix).
      const docs = [];
      for (const group of groups) {
        const numeroHoja = await sheetWorkService._resolveNumeroHoja(group.ot._id, tenantId);
        docs.push({
          tenantId,
          clienteId: group.ot.ClienteId,
          otId: group.ot._id,
          reports: group.reportsInGroup,
          source: 'client-portal',
          cargoRecibe: body.signature.cargo || '',
          personaRecibe: body.signature.signerName,
          firmaFile: firmaFileUrl,
          responsable: creator._id,
          fullNameResponsable: creator.fullName,
          cargoResponsable: creator.role,
          firmaResponsableFile: creator.fileFirma,
          numeroHoja,
          estado: 'Firmada',
          // Optional free-form notes captured at sign time; prints in the HT
          // PDF's "Observaciones" section (2026-08-02 UX ask).
          observaciones: body.signature.observaciones || '',
          clientSignature: {
            ip: meta.ip || null,
            userAgent: meta.userAgent || null,
            contentHash,
            signedAt: new Date(),
            signedBatchId,
            tokenId,
          },
          pdfStatus: 'pending',
        });
      }

      // 8/9. Insert. If insertMany fails partway (ordered writes stop at the
      // first error but do NOT roll back earlier successful inserts),
      // cleanup by signedBatchId before rethrowing.
      let insertedSheets;
      try {
        insertedSheets = await SheetWork.insertMany(docs);
      } catch (insertErr) {
        await SheetWork.deleteMany({ 'clientSignature.signedBatchId': signedBatchId, tenantId }).catch(() => {});
        logger.error('signAndCreateSheets: insertMany failed, rolled back', {
          signedBatchId,
          err: String(insertErr),
        });
        throw new ApiError(500, 'Error creando las hojas de trabajo', 'SHEET_CREATE_ERROR');
      }

      // 10. Claim reports in ONE bulkWrite so partial rollback is precise.
      // We only touch `hojaDeTrabajo` here (not `estado`) — that keeps the
      // rollback simple: `unset hojaDeTrabajo where it points at one of our
      // sheets`. Estado gets bumped separately in step 11 (best-effort).
      //
      // The filter re-checks `clientReview.reviewedAt: { $ne: null }` to
      // close the TOCTOU gap flagged by adversarial review (a client who
      // races their own DELETE /review against their in-flight POST /sign
      // could otherwise sign an unreviewed report). This DOES mean an
      // unreviewed report shows up as a "conflict" here rather than being
      // rejected in step 3 — that's fine, the response body still lists it.
      const sheetIds = insertedSheets.map((s) => s._id);
      const bulkOps = groups.map((group) => {
        const sheet = insertedSheets.find((s) => String(s.otId) === String(group.ot._id));
        return {
          updateMany: {
            filter: {
              _id: { $in: group.reportsInGroup },
              tenantId,
              hojaDeTrabajo: null,
              'clientReview.reviewedAt': { $ne: null },
            },
            update: { $set: { hojaDeTrabajo: sheet._id } },
          },
        };
      });

      let bulkResult;
      try {
        bulkResult = await Report.bulkWrite(bulkOps, { ordered: false });
      } catch (bulkErr) {
        // ordered:false surfaces per-op errors as a BulkWriteError but the
        // partially-applied ops still land. Fall through to matchedCount
        // check; the revert path handles both.
        bulkResult = bulkErr?.result || bulkErr?.writeResult || {};
        logger.warn('signAndCreateSheets: bulkWrite partially threw', {
          signedBatchId,
          err: String(bulkErr),
        });
      }
      const totalMatched = bulkResult?.matchedCount ?? bulkResult?.nMatched ?? 0;

      if (totalMatched < reportIds.length) {
        // Revert ONLY the reports we actually flipped (identified by their
        // hojaDeTrabajo pointing at one of our fresh sheets), then delete
        // the sheets. Never touches reports belonging to another batch.
        await Report.updateMany(
          { _id: { $in: reportIds }, tenantId, hojaDeTrabajo: { $in: sheetIds } },
          { $unset: { hojaDeTrabajo: '' } }
        ).catch((revertErr) => {
          logger.error('signAndCreateSheets: report revert FAILED — potential orphan reports', {
            signedBatchId,
            sheetIds: sheetIds.map(String),
            err: String(revertErr),
          });
        });
        await SheetWork.deleteMany({ 'clientSignature.signedBatchId': signedBatchId, tenantId }).catch(() => {});

        // Compute conflicting IDs (reports either sheeted by another batch or
        // whose clientReview vanished mid-flight).
        const conflicts = await Report.find({
          _id: { $in: reportIds },
          tenantId,
          $or: [
            { hojaDeTrabajo: { $ne: null } },
            { 'clientReview.reviewedAt': null },
          ],
        }).select('_id').lean();
        const conflictingReportIds = conflicts.map((r) => String(r._id));

        logger.warn('signAndCreateSheets: rollback — concurrent conflict or lost review', {
          signedBatchId,
          conflictingReportIds,
        });
        throw new ApiError(
          409,
          'Uno o más reportes ya fueron firmados o dejaron de estar revisados durante el proceso.',
          'REPORT_ALREADY_SIGNED',
          { conflictingReportIds }
        );
      }

      // 10b. Estado bump + fechaFinalizdo — best-effort. Failure here
      // doesn't corrupt the audit trail (sheets exist, reports point at
      // their sheet); it just leaves the report label lagging one step.
      //
      // design D1 (portal-signature-flow): reports move to `Cerrado` (not
      // `Procesado`) — feature parity with the admin sheet-creation flow
      // (sheetwork.service.js#create), so `OT.Avance`/`EstadoOt` and the
      // ticket cascade below actually have something to react to.
      //
      // Also stamps `fechaFinalizdo` because the admin OT view's
      // "Reportes Cerrados" tab filters by that date being set, not by
      // estado. Without this the signed reports would linger in the
      // "Pendientes" tab from the admin's POV (2026-08-02 UX bug fix).
      // Uses `$set` only when missing so we don't retro-move the date
      // for reports that had it set by a prior technician close.
      const signedAt = new Date();
      await Report.updateMany(
        { _id: { $in: reportIds }, tenantId },
        [
          {
            $set: {
              estado: 'Cerrado',
              fechaFinalizdo: { $ifNull: ['$fechaFinalizdo', signedAt] },
            },
          },
        ]
      ).catch((estadoErr) => {
        logger.warn('signAndCreateSheets: estado bulk update failed (non-fatal)', {
          signedBatchId,
          err: String(estadoErr),
        });
      });

      // 10c. Recompute Avance/EstadoOt for every OT touched by this batch
      // (design D1) — same pattern as sheetwork.service.js#create /
      // ot.service.js. Best-effort: a failure here leaves the OT badge
      // stale but never corrupts the report/sheet state already committed.
      const otIdsInBatch = [...new Set(groups.map((g) => String(g.ot._id)))];
      for (const otId of otIdsInBatch) {
        try {
          const total = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false }, tenantId));
          const closed = await Report.countDocuments(
            applyTenantFilter({ orden: otId, isDeleted: false, estado: 'Cerrado' }, tenantId)
          );
          const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
          let nuevoEstado = 'Pendiente';
          if (closed === total && total > 0) nuevoEstado = 'Cerrado';
          else if (closed > 0) nuevoEstado = 'En Progreso';
          await OT.findOneAndUpdate(applyTenantFilter({ _id: otId }, tenantId), {
            $set: { Avance: avance, EstadoOt: nuevoEstado },
          });
        } catch (otErr) {
          logger.warn('signAndCreateSheets: OT progress recompute failed (non-fatal)', {
            signedBatchId,
            otId,
            err: String(otErr),
          });
        }
      }

      // 10d. Ticket cascade (design D2) — never breaks the signature flow.
      try {
        await triggerTicketCascadeOnClose(reportIds, tenantId);
      } catch (cascadeErr) {
        logger.warn('signAndCreateSheets: ticket cascade failed (non-fatal)', {
          signedBatchId,
          err: String(cascadeErr),
        });
      }

      // Note: `sheetIds` above is declared as ObjectId[] for the revert
      // filter; re-shape to string[] for the API response.
      const sheetIdStrings = insertedSheets.map((s) => String(s._id));
      logger.info('signAndCreateSheets: success', { signedBatchId, sheetIds: sheetIdStrings });

      // 11. Fire-and-forget PDF generation (design D8).
      setImmediate(() => {
        this.generatePdfsForBatch(signedBatchId, tenantId).catch((err) => {
          logger.warn('generatePdfsForBatch: batch failed', { signedBatchId, err: String(err) });
        });
      });

      return { signedBatchId, sheetIds: sheetIdStrings, pdfStatus: 'pending' };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('signAndCreateSheets: unexpected error', { signedBatchId, err: String(err) });
      throw new ApiError(500, 'Error al firmar los reportes', 'SIGN_ERROR');
    }
  }

  /**
   * Background PDF generation for every SheetWork of a signed batch (design
   * D8). Reuses the existing microservice-backed generator
   * (sheetworkPDF.service.js — task 8.1: confirmed sync-in-process call that
   * delegates HTML->PDF rendering to a Puppeteer microservice via
   * pdfMicroserviceClient.js; the buffer is generated per-call and, prior to
   * this change, was streamed directly to the caller and never persisted —
   * this method is the first place a SheetWork PDF gets a durable URL).
   * Fire-and-forget from the caller; never throws.
   */
  /**
   * Renders a live preview of the N HTs that would be created if the
   * caller submitted the same body to `POST /sign`. Doesn't persist
   * anything, doesn't upload the signature — the PNG travels as an inline
   * data-URL directly into the PDF template so what the client sees is a
   * 1:1 rendering of the eventual deliverable. Reuses the same
   * eligibility gates as `signAndCreateSheets` (token creator with firma,
   * all reports reviewed, OT membership) so the preview can never show
   * something the sign endpoint would reject.
   *
   * Returned HTML concatenates one full document per OT with a CSS page
   * break between them; the frontend renders it inside an iframe.
   */
  async previewSignAsHtml(tenantId, tokenId, otIds, body) {
    requireTenant(tenantId);

    const token = await ClientAccessToken.findById(tokenId)
      .populate({ path: 'createdBy', select: 'fullName role fileFirma isDeleted' })
      .populate({ path: 'attributionUserId', select: 'fullName role fileFirma isDeleted' });
    const attributed = token?.attributionUserId || token?.createdBy;
    if (!attributed || attributed.isDeleted === true || !attributed.fileFirma) {
      throw new ApiError(
        409,
        'Este acceso no puede firmar HTs. Solicite un nuevo acceso al administrador.',
        'TOKEN_CREATOR_INVALID'
      );
    }
    const creator = attributed;

    const reportIds = (body.reportIds || []).map(String);
    if (reportIds.length === 0) {
      throw new ApiError(400, 'No hay reportes seleccionados para firmar.', 'SIGN_REQUIRES_REVIEW');
    }

    // Same populate shape as the admin PDF flow — the template pulls
    // client + equipo data from these sub-docs when rendering.
    const reports = await Report.find({ _id: { $in: reportIds }, tenantId })
      .populate('ClienteId')
      .populate({ path: 'Equipo', populate: { path: 'SedeId' } })
      .lean();
    if (reports.length !== reportIds.length) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }
    const unreviewedReportIds = reports
      .filter((r) => !r.clientReview?.reviewedAt)
      .map((r) => String(r._id));
    if (unreviewedReportIds.length) {
      throw new ApiError(
        400,
        'Algunos reportes no han sido revisados.',
        'SIGN_REQUIRES_REVIEW',
        { unreviewedReportIds }
      );
    }

    const ots = await OT.find({ _id: { $in: otIds }, tenantId, reportes: { $in: reportIds } })
      .select('_id Consecutivo reportes ClienteId')
      .populate({ path: 'ClienteId' })
      .lean();

    const reportIdSet = new Set(reportIds);
    const groups = ots
      .map((ot) => ({
        ot,
        reportsInGroup: (ot.reportes || [])
          .map(String)
          .filter((rid) => reportIdSet.has(rid))
          .map((rid) => reports.find((r) => String(r._id) === rid))
          .filter(Boolean),
      }))
      .filter((g) => g.reportsInGroup.length > 0);

    if (groups.length === 0) {
      throw new ApiError(404, 'Reporte no encontrado', 'REPORT_NOT_FOUND');
    }

    const tenantData = await Tenant.findOne({ tenantId, isDeleted: false }).lean();

    // The cliente-signature image travels inline as a data URL — the
    // template only cares that `sheetWork.firmaFile` is a URL that the
    // browser can render. base64 in the PNG string → data URL. If the
    // caller didn't draw yet, we render an empty firma spot so the
    // client can see the layout without the signature glyph.
    const imagePng = body?.signature?.imagePng || '';
    const firmaClienteDataUrl = imagePng
      ? `data:image/png;base64,${imagePng}`
      : '';

    const signedAt = new Date();
    const previewHtmls = groups.map((group, index) => {
      const syntheticSheet = {
        _id: `preview-${index}`,
        tenantId,
        clienteId: group.ot.ClienteId,
        otId: group.ot,
        reports: group.reportsInGroup,
        source: 'client-portal',
        estado: 'Firmada',
        cargoRecibe: body?.signature?.cargo || '',
        personaRecibe: body?.signature?.signerName || '',
        observaciones: body?.signature?.observaciones || '',
        firmaFile: firmaClienteDataUrl,
        firmaResponsableFile: creator.fileFirma,
        fullNameResponsable: creator.fullName,
        cargoResponsable: creator.role,
        numeroHoja: `${group.ot.Consecutivo || 'OT'} · Vista previa`,
        createdAt: signedAt,
      };
      return this.pdfService.generateHTML(syntheticSheet, tenantData || {});
    });

    // Stitch N documents with a hard page break so the client can
    // scroll through each HT in the preview iframe.
    if (previewHtmls.length === 1) return previewHtmls[0];
    const separator = `
      <div style="page-break-before: always; margin: 24px 0; padding: 12px; text-align:center; color:#666; background:#f5f5f5; border-radius:8px; font-family:Arial,sans-serif;">
        — Siguiente hoja de trabajo —
      </div>`;
    return previewHtmls.join(separator);
  }

  async generatePdfsForBatch(signedBatchId, tenantId) {
    const sheets = await SheetWork.find({ 'clientSignature.signedBatchId': signedBatchId, tenantId }).lean();

    for (const sheet of sheets) {
      try {
        const pdfBuffer = await this.pdfService.generatePDF(String(sheet._id), tenantId);
        const { url } = await firebaseStorageService.uploadPdf(
          pdfBuffer,
          `HT-${sheet.numeroHoja || sheet._id}.pdf`,
          'sheetwork/pdfs'
        );
        await SheetWork.updateOne(
          { _id: sheet._id },
          { $set: { PdfHojaTrabajo: url, PdfGenerado: true, pdfStatus: 'ready' } }
        );
      } catch (err) {
        logger.warn('generatePdfsForBatch: PDF generation failed for sheet', {
          sheetId: String(sheet._id),
          signedBatchId,
          err: String(err),
        });
        await SheetWork.updateOne(
          { _id: sheet._id },
          { $set: { pdfStatus: 'error', pdfGenerationError: err.message } }
        ).catch(() => {});
      }
    }
  }

  /**
   * List all SIGNED sheets whose OT is in the current token's scope
   * (sheetwork-share-and-portal-widening — reads open, D12 stays on writes).
   * Includes sheets signed under a different token or on-site, as long as the
   * OT is one of the token's `otIds` and `firmaFile` is populated.
   */
  async getSheetsForToken(tenantId, tokenId) {
    requireTenant(tenantId);

    const token = await ClientAccessToken.findById(tokenId).select('otIds').lean();
    const otIds = token?.otIds || [];
    if (otIds.length === 0) return { sheets: [] };

    const sheets = await SheetWork.find({
      tenantId,
      otId: { $in: otIds },
      firmaFile: { $exists: true, $ne: null, $nin: [''] },
      isDeleted: false,
    })
      .populate({ path: 'otId', select: 'Consecutivo' })
      .sort({ 'clientSignature.signedAt': -1, updatedAt: -1 })
      .lean();

    return {
      sheets: sheets.map((d) => ({
        _id: String(d._id),
        numeroHoja: d.numeroHoja || null,
        otId: d.otId ? String(d.otId._id) : null,
        otConsecutivo: d.otId ? d.otId.Consecutivo : null,
        signedAt: d.clientSignature?.signedAt || d.updatedAt || null,
        pdfStatus: d.pdfStatus,
        pdfUrl: d.PdfHojaTrabajo || null,
        // firmaFile always populated post-widening (we filter on it), but
        // exposed for API-shape consistency with previous versions.
        firmaFile: d.firmaFile || null,
      })),
    };
  }

  /**
   * Resolves the PDF URL of a sheet — widened to allow any signed sheet
   * whose OT is in the current token's scope
   * (sheetwork-share-and-portal-widening). D12 remains only on writes
   * (`signExistingSheet`).
   */
  async getSheetPdfLocation(tenantId, tokenId, sheetId) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(sheetId)) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    const token = await ClientAccessToken.findById(tokenId).select('otIds').lean();
    const otIds = token?.otIds || [];
    if (otIds.length === 0) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    const sheet = await SheetWork.findOne({
      _id: sheetId,
      tenantId,
      otId: { $in: otIds },
      firmaFile: { $exists: true, $ne: null, $nin: [''] },
    }).lean();
    if (!sheet) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    if (sheet.pdfStatus === 'pending') {
      throw new ApiError(425, 'PDF aún se está generando', 'PDF_PENDING');
    }

    if (sheet.pdfStatus === 'error') {
      throw new ApiError(500, 'La generación del PDF falló', 'PDF_GENERATION_FAILED');
    }

    return { url: sheet.PdfHojaTrabajo };
  }

  /**
   * Late-sign: attaches a client signature to a `SheetWork` whose
   * `firmaFile` is still empty (design D3/D7, portal-signature-flow).
   * Scoped to the SAME token that originally created the sheet (gate D12,
   * same as `getSheetPdfLocation`/`getSheetReportsZip`) — a fresh or
   * different token for the same client can never late-sign a sheet it
   * didn't create; a mismatch resolves to the same 404 as a nonexistent
   * sheet (no existence leak).
   *
   * Only `SheetWork` fields are mutated here — the linked `Report`s are
   * already `Cerrado` (post-D1) or handled separately by the admin
   * close-reports control (D6); this endpoint never touches `Report`.
   *
   * @param {string} tenantId
   * @param {string} tokenId
   * @param {string} sheetId
   * @param {{ signature: { imagePng, signerName, signerId?, cargo?, observaciones? } }} body
   * @param {{ ip?: string, userAgent?: string }} [meta]
   */
  async signExistingSheet(tenantId, tokenId, sheetId, body, meta = {}) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(sheetId)) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    // Pre-check for a clear 404 vs 409 distinction (and to have the
    // signedBatchId handy). The mutating write below is atomic so we don't
    // depend on this read for correctness under concurrency.
    //
    // Note (sheetwork-share-and-portal-widening): read-only endpoints
    // (`getSheetsForToken`, `getSheetPdfLocation`, `getSheetReportsZip`)
    // widened to `otId ∈ token.otIds`. This write endpoint keeps the D12
    // gate on purpose — a fresh/different token must never late-sign a
    // sheet it didn't create.
    const preSheet = await SheetWork.findOne({
      _id: sheetId,
      tenantId,
      'clientSignature.tokenId': tokenId,
      isDeleted: false,
    }).lean();
    if (!preSheet) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }
    if (preSheet.firmaFile) {
      throw new ApiError(409, 'Esta hoja de trabajo ya fue firmada.', 'SHEET_ALREADY_SIGNED');
    }

    const signatureBuffer = Buffer.from(body.signature.imagePng, 'base64');
    const { url: firmaFileUrl } = await firebaseStorageService.uploadEvidencia(
      signatureBuffer,
      `firma-${sheetId}-late.png`,
      'image/png',
      'client-portal/firmas'
    );

    const setUpdate = {
      firmaFile: firmaFileUrl,
      personaRecibe: body.signature.signerName,
      cargoRecibe: body.signature.cargo || '',
      estado: 'Firmada',
      // Audit trail (spec "Late-sign preserves audit trail"):
      // `signedBatchId`, `contentHash`, `tokenId`, `ip`, `userAgent` MUST
      // stay unchanged so a signer-dispute investigation later can trace
      // back to the ORIGINAL requester. Only `signedAt` is refreshed to
      // reflect when the signature was actually captured.
      'clientSignature.signedAt': new Date(),
      pdfStatus: 'pending',
    };
    if (typeof body.signature.observaciones === 'string' && body.signature.observaciones.trim() !== '') {
      setUpdate.observaciones = body.signature.observaciones;
    }

    // Atomic check-and-set closes the concurrency race: two clients hitting
    // the endpoint at the same moment both pass the pre-check, both upload a
    // PNG to Firebase, and without this filter both would call save() with
    // the LAST write winning silently. The `firmaFile: $in [null, '']`
    // clause makes the loser's update match zero documents so we can
    // surface a 409 instead of dropping the signature on the floor. `null`
    // in `$in` also matches the absent-field case.
    const sheet = await SheetWork.findOneAndUpdate(
      {
        _id: sheetId,
        tenantId,
        'clientSignature.tokenId': tokenId,
        isDeleted: false,
        firmaFile: { $in: [null, ''] },
      },
      { $set: setUpdate },
      { new: true }
    );
    if (!sheet) {
      // Losing side of a concurrent late-sign race. The PNG we just uploaded
      // to Firebase is orphaned — accepted trade-off (no delete API wired
      // for evidence buckets, and the collision is inherently rare on the
      // portal's low-concurrency profile).
      throw new ApiError(409, 'Esta hoja de trabajo ya fue firmada.', 'SHEET_ALREADY_SIGNED');
    }

    logger.info('signExistingSheet: sheet late-signed', { sheetId: String(sheet._id), tenantId });

    // Fire-and-forget PDF regeneration for the whole batch this sheet
    // belongs to (design D7) — mirrors signAndCreateSheets step 11.
    const signedBatchId = sheet.clientSignature.signedBatchId;
    setImmediate(() => {
      this.generatePdfsForBatch(signedBatchId, tenantId).catch((err) => {
        logger.warn('signExistingSheet: PDF regeneration failed', {
          sheetId: String(sheet._id),
          signedBatchId,
          err: String(err),
        });
      });
    });

    return { sheetId: String(sheet._id), pdfStatus: 'pending' };
  }

  /**
   * Generates a ZIP with one PDF per report of a signed sheet — widened to
   * any signed sheet whose OT is in the current token's scope
   * (sheetwork-share-and-portal-widening). D12 remains only on writes
   * (`signExistingSheet`).
   */
  async getSheetReportsZip(tenantId, tokenId, sheetId) {
    requireTenant(tenantId);

    if (!mongoose.isValidObjectId(sheetId)) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    const token = await ClientAccessToken.findById(tokenId).select('otIds').lean();
    const otIds = token?.otIds || [];
    if (otIds.length === 0) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    const sheet = await SheetWork.findOne({
      _id: sheetId,
      tenantId,
      otId: { $in: otIds },
      firmaFile: { $exists: true, $ne: null, $nin: [''] },
      isDeleted: false,
    }).lean();
    if (!sheet) {
      throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    }

    const reports = await Report.find({ hojaDeTrabajo: sheetId, tenantId, isDeleted: false })
      .populate('ClienteId')
      .populate({ path: 'Equipo', populate: { path: 'SedeId' } })
      .populate('ResponsableMtto', 'fullName role')
      .populate('orden', 'Consecutivo TipoServicio')
      .populate(
        'hojaDeTrabajo',
        'personaRecibe cargoRecibe firmaResponsableFile firmaFile numeroHoja cargoResponsable fullNameResponsable'
      )
      .lean();

    if (!reports.length) {
      throw new ApiError(404, 'No hay reportes asociados a esta hoja', 'REPORTS_NOT_FOUND');
    }

    const reportsWithRepuestos = await Promise.all(
      reports.map(async (r) => {
        const repuestos = await Repuestos.find({
          tenantId,
          $or: [{ ReporteSolicitudId: r._id }, { ReporteInstalacionId: r._id }],
        }).lean();
        return { ...r, repuestos };
      })
    );

    const tenantData = await Tenant.findOne({ tenantId, isDeleted: false }).lean();
    const generator = new BulkPDFGenerator();
    const template = getHTMLTemplate();
    const zipBuffer = await generator.generateBulkPDFs(reportsWithRepuestos, (report) =>
      generateHTMLFromReport(report, tenantData || {}, template)
    );

    const iso = new Date().toISOString().split('T')[0];
    const filename = `reportes_${sheet.numeroHoja || sheetId}_${iso}.zip`;
    return { zipBuffer, filename };
  }
}

export const clientPortalService = new ClientPortalService();
