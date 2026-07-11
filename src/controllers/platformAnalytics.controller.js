import { PlatformAnalyticsService } from '../services/platformAnalytics.service.js';
import { buildCsv } from '../utils/csvBuilder.util.js';
import { successResponse } from '../utils/apiResponse.util.js';

/** Columns for the tenants CSV export — headers in Spanish per spec. */
const CSV_COLUMNS = [
  { key: 'tenantId', label: 'ID' },
  { key: 'tenantName', label: 'Nombre' },
  { key: 'status', label: 'Estado' },
  { key: 'plan', label: 'Plan' },
  { key: 'createdAt', label: 'Creado' },
  { key: 'usersCount', label: 'Usuarios' },
  { key: 'equiposCount', label: 'Equipos' },
  { key: 'otsOpen', label: 'OTs Abiertas' },
  { key: 'otsClosed', label: 'OTs Cerradas' },
  { key: 'reportsCount', label: 'Reportes' },
];

/**
 * PlatformAnalyticsController — pure binding: req → service → res.
 * No business logic lives here.
 */
export class PlatformAnalyticsController {
  /**
   * GET /api/v1/platform/analytics
   * Query: from, to (ISO dates, optional)
   * Returns the 6-property summary object for KPI cards + charts.
   */
  static async summary(req, res, next) {
    try {
      const { from, to } = req.query;
      const result = await PlatformAnalyticsService.summary({ from, to });
      return res.status(200).json(successResponse(result, 'Analytics summary recuperado'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/v1/platform/analytics/tenants
   * Query: from, to, includeDeleted
   * Returns an array of per-tenant breakdown rows.
   */
  static async tenants(req, res, next) {
    try {
      const { from, to, includeDeleted } = req.query;
      const result = await PlatformAnalyticsService.tenantsBreakdown({
        from,
        to,
        includeDeleted: includeDeleted === true || includeDeleted === 'true',
      });
      return res.status(200).json(successResponse(result, 'Tenants breakdown recuperado'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/v1/platform/analytics/tenants.csv
   * Query: from, to, includeDeleted
   * Returns a UTF-8 CSV file with BOM for correct Excel rendering.
   */
  static async tenantsCsv(req, res, next) {
    try {
      const { from, to, includeDeleted } = req.query;

      const rows = await PlatformAnalyticsService.tenantsBreakdown({
        from,
        to,
        includeDeleted: includeDeleted === true || includeDeleted === 'true',
      });

      // Format createdAt to YYYY-MM-DD for human-readable CSV output.
      const formattedRows = rows.map((row) => ({
        ...row,
        createdAt: row.createdAt
          ? new Date(row.createdAt).toISOString().slice(0, 10)
          : '',
      }));

      const csv = buildCsv(formattedRows, CSV_COLUMNS);

      const todayStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tenants-analytics-${todayStr}.csv"`,
      );

      // Prepend UTF-8 BOM so Excel opens accented characters correctly.
      return res.send('﻿' + csv);
    } catch (err) {
      return next(err);
    }
  }
}

export const platformAnalyticsController = PlatformAnalyticsController;
