'use strict';
import { Report } from '../models/report.model.js';
import { applyTenantFilter } from './tenant.util.js';
import { ticketService } from '../services/ticket.service.js';
import { logger } from '../config/logger.config.js';

/**
 * Shared ticket-closure cascade (design D2, portal-signature-flow).
 *
 * Extracted from the inline block that used to live twice in
 * `report.service.js` (`update()` and `procesar()`), now also reused by
 * `clientPortal.service.js#signAndCreateSheets` and
 * `sheetwork.service.js#closeReports`.
 *
 * Re-queries the given reports (scoped to `tenantId`) and, for each one that
 * is linked to a ticket (`isFromTicket: true` + `ticket` set) and currently
 * sits in a terminal `estado` (`Cerrado` / `Cancelado`), dispatches the
 * matching `ticketService` cascade method.
 *
 * Idempotent: `ticketService.closeFromReport` / `cancelFromReport` are
 * themselves no-ops (no `ticket.save()` call) when the ticket is already
 * `cerrado`/`cancelado`, so calling this helper twice for the same report
 * never produces a duplicate write.
 *
 * @param {string[]} reportIds
 * @param {string} tenantId
 * @param {{ panelUser?: object|null }} [options] - forwarded to
 *   ticketService for `closedBy` attribution when the caller has a panel
 *   user in context (report.service.js update/procesar). Portal/admin bulk
 *   callers omit it (no panel user in scope) and the ticket is closed with
 *   `closedBy: null`.
 */
export async function triggerTicketCascadeOnClose(reportIds, tenantId, { panelUser = null } = {}) {
  const ids = (reportIds || []).filter(Boolean);
  if (!ids.length || !tenantId) return;

  let reports;
  try {
    reports = await Report.find(
      applyTenantFilter(
        {
          _id: { $in: ids },
          isFromTicket: true,
          ticket: { $ne: null },
          estado: { $in: ['Cerrado', 'Cancelado'] },
        },
        tenantId
      )
    ).lean();
  } catch (err) {
    logger.error('triggerTicketCascadeOnClose: failed to load reports', {
      tenantId,
      err: String(err),
    });
    return;
  }

  for (const report of reports) {
    try {
      if (report.estado === 'Cerrado') {
        await ticketService.closeFromReport(report, panelUser);
      } else if (report.estado === 'Cancelado') {
        await ticketService.cancelFromReport(report, panelUser);
      }
    } catch (err) {
      logger.error('triggerTicketCascadeOnClose: cascade failed for report', {
        reportId: String(report._id),
        tenantId,
        err: String(err),
      });
    }
  }
}
