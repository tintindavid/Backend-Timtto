import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

/** OT statuses that indicate an open / in-progress work order. */
const OPEN_OT_STATUSES = ['Pendiente', 'Abierto', 'En Progreso'];

/** Full set of OT service types. Diagnóstico (with tilde) retained for
 *  migration compatibility alongside the normalized 'Diagnostico'. */
const OT_TYPES = ['Preventivo', 'Correctivo', 'Predictivo', 'Instalación', 'Proactivo', 'Diagnostico', 'Diagnóstico'];

/** Recognized user roles across the platform. */
const USER_ROLES = ['admin', 'technician', 'user', 'superadmin'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds an optional Mongoose date-range filter for `createdAt`.
 * Returns an empty object when neither bound is supplied so it can be spread
 * into a $match stage without side-effects.
 *
 * @param {Date|string|undefined} from
 * @param {Date|string|undefined} to
 * @returns {object}  e.g. { createdAt: { $gte: Date, $lte: Date } }
 */
function buildDateFilter(from, to) {
  if (!from && !to) return {};
  const createdAt = {};
  if (from) createdAt.$gte = new Date(from);
  if (to) createdAt.$lte = new Date(to);
  return { createdAt };
}

/**
 * Reduces an array of { _id, count } documents returned by a $group stage
 * into a plain object keyed by _id with count values, e.g.:
 *   [{ _id: 'active', count: 3 }] → { active: 3 }
 *
 * @param {Array<{_id: string, count: number}>} arr
 * @returns {Record<string, number>}
 */
function groupArrayToMap(arr) {
  return arr.reduce((acc, item) => {
    if (item._id !== null && item._id !== undefined) {
      acc[item._id] = item.count;
    }
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * PlatformAnalyticsService — cross-tenant read-only aggregations for SuperAdmin.
 *
 * NOTE: these methods intentionally do NOT take `tenantId` as first parameter
 * because they operate across all tenants (documented exception to the
 * multi-tenant invariant, per design DA-1).
 */
export class PlatformAnalyticsService {
  /**
   * Returns a single-response snapshot of all global KPIs and chart data.
   *
   * Filters `from`/`to` apply ONLY to time-based metrics (OTs, equipos
   * timeline). Tenant/user stats always reflect the current state.
   *
   * @param {object} opts
   * @param {Date|string} [opts.from]
   * @param {Date|string} [opts.to]
   * @returns {Promise<{tenantStats, userStats, equipoTotal, otStats, otsPerTenant, equiposTimeline}>}
   */
  static async summary({ from, to } = {}) {
    const dateFilter = buildDateFilter(from, to);

    // Default equipos timeline window: last 12 months when no `from` provided.
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    const equiposFromDate = from ? new Date(from) : twelveMonthsAgo;

    const [
      tenantStatusGroups,
      userRoleGroups,
      equipoTotal,
      otFacetResult,
      otsPerTenant,
      equiposTimeline,
    ] = await Promise.all([

      // 1. Tenant stats — current state, no date filter
      Tenant.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // 2. User stats — current state, no date filter
      User.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),

      // 3. Equipo total — current state, no date filter
      EquipoItem.countDocuments({ isDeleted: false }),

      // 4. OT stats — $facet for byStatus and byType, date filter applied
      OT.aggregate([
        { $match: { isDeleted: false, ...dateFilter } },
        {
          $facet: {
            byStatus: [
              { $group: { _id: '$EstadoOt', count: { $sum: 1 } } },
            ],
            byType: [
              { $group: { _id: '$TipoServicio', count: { $sum: 1 } } },
            ],
          },
        },
      ]),

      // 5. OTs per tenant (top 20 open OTs, date filter applied)
      OT.aggregate([
        {
          $match: {
            isDeleted: false,
            EstadoOt: { $in: OPEN_OT_STATUSES },
            ...dateFilter,
          },
        },
        { $group: { _id: '$tenantId', count: { $sum: 1 } } },
        {
          $lookup: {
            from: 'tenants',
            localField: '_id',
            foreignField: 'tenantId',
            as: 'tenant',
          },
        },
        { $unwind: { path: '$tenant', preserveNullAndEmpty: false } },
        {
          $project: {
            _id: 0,
            tenantId: '$_id',
            tenantName: '$tenant.name',
            count: 1,
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // 6. Equipos timeline — grouped by month, date filter applied
      EquipoItem.aggregate([
        { $match: { isDeleted: false, createdAt: { $gte: equiposFromDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: '$_id', count: 1 } },
      ]),
    ]);

    // Transform tenantStatusGroups → { total, active, suspended, closed }
    const statusMap = groupArrayToMap(tenantStatusGroups);
    const tenantStats = {
      total: tenantStatusGroups.reduce((s, g) => s + g.count, 0),
      active: statusMap.active ?? 0,
      suspended: statusMap.suspended ?? 0,
      closed: statusMap.closed ?? 0,
    };

    // Transform userRoleGroups → { total, admin, technician, user, superadmin }
    const roleMap = groupArrayToMap(userRoleGroups);
    const userStats = {
      total: userRoleGroups.reduce((s, g) => s + g.count, 0),
      ...USER_ROLES.reduce((acc, r) => { acc[r] = roleMap[r] ?? 0; return acc; }, {}),
    };

    // Transform OT facet result
    const { byStatus = [], byType = [] } = otFacetResult[0] ?? {};
    const otStatusMap = groupArrayToMap(byStatus);
    const otTypeMap = groupArrayToMap(byType);

    const open = OPEN_OT_STATUSES.reduce((s, st) => s + (otStatusMap[st] ?? 0), 0);
    // closed and cancelled are computed from remaining statuses not in OPEN
    const otsClosed = Object.entries(otStatusMap)
      .filter(([status]) => !OPEN_OT_STATUSES.includes(status))
      .reduce((s, [, count]) => s + count, 0);

    const otStats = {
      open,
      closed: otsClosed,
      byType: OT_TYPES.reduce((acc, t) => { acc[t] = otTypeMap[t] ?? 0; return acc; }, {}),
    };

    return {
      tenantStats,
      userStats,
      equipoTotal,
      otStats,
      otsPerTenant,
      equiposTimeline,
    };
  }

  /**
   * Returns per-tenant breakdown with counts of users, equipos, OTs, reports.
   *
   * @param {object} opts
   * @param {Date|string} [opts.from]
   * @param {Date|string} [opts.to]
   * @param {boolean} [opts.includeDeleted=false]
   * @returns {Promise<Array<TenantBreakdownRow>>}
   */
  static async tenantsBreakdown({ from, to, includeDeleted = false } = {}) {
    const dateFilter = buildDateFilter(from, to);

    const tenantMatch = {};
    if (!includeDeleted) {
      tenantMatch.isDeleted = false;
    }

    const rows = await Tenant.aggregate([
      { $match: tenantMatch },

      // Users count (no date filter — current state)
      {
        $lookup: {
          from: 'users',
          let: { tid: '$tenantId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tenantId', '$$tid'] },
                isDeleted: false,
              },
            },
            { $count: 'n' },
          ],
          as: 'usersLookup',
        },
      },
      {
        $addFields: {
          usersCount: { $ifNull: [{ $arrayElemAt: ['$usersLookup.n', 0] }, 0] },
        },
      },

      // Equipos count (no date filter — current state)
      {
        $lookup: {
          from: 'equipo-items',
          let: { tid: '$tenantId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tenantId', '$$tid'] },
                isDeleted: false,
                ...(Object.keys(dateFilter).length ? dateFilter : {}),
              },
            },
            { $count: 'n' },
          ],
          as: 'equiposLookup',
        },
      },
      {
        $addFields: {
          equiposCount: { $ifNull: [{ $arrayElemAt: ['$equiposLookup.n', 0] }, 0] },
        },
      },

      // Open OTs count
      {
        $lookup: {
          from: 'ots',
          let: { tid: '$tenantId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tenantId', '$$tid'] },
                isDeleted: false,
                EstadoOt: { $in: OPEN_OT_STATUSES },
                ...(Object.keys(dateFilter).length ? dateFilter : {}),
              },
            },
            { $count: 'n' },
          ],
          as: 'otsOpenLookup',
        },
      },
      {
        $addFields: {
          otsOpen: { $ifNull: [{ $arrayElemAt: ['$otsOpenLookup.n', 0] }, 0] },
        },
      },

      // Closed OTs count (any status NOT in OPEN_OT_STATUSES)
      {
        $lookup: {
          from: 'ots',
          let: { tid: '$tenantId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tenantId', '$$tid'] },
                isDeleted: false,
                EstadoOt: { $nin: OPEN_OT_STATUSES },
                ...(Object.keys(dateFilter).length ? dateFilter : {}),
              },
            },
            { $count: 'n' },
          ],
          as: 'otsClosedLookup',
        },
      },
      {
        $addFields: {
          otsClosed: { $ifNull: [{ $arrayElemAt: ['$otsClosedLookup.n', 0] }, 0] },
        },
      },

      // Reports count
      {
        $lookup: {
          from: 'reports',
          let: { tid: '$tenantId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$tenantId', '$$tid'] },
                isDeleted: false,
                ...(Object.keys(dateFilter).length ? dateFilter : {}),
              },
            },
            { $count: 'n' },
          ],
          as: 'reportsLookup',
        },
      },
      {
        $addFields: {
          reportsCount: { $ifNull: [{ $arrayElemAt: ['$reportsLookup.n', 0] }, 0] },
        },
      },

      // Project to the 10-column shape defined in design D4
      {
        $project: {
          _id: 0,
          tenantId: 1,
          tenantName: '$name',
          status: 1,
          plan: 1,
          createdAt: 1,
          usersCount: 1,
          equiposCount: 1,
          otsOpen: 1,
          otsClosed: 1,
          reportsCount: 1,
        },
      },

      { $sort: { tenantName: 1 } },
    ]);

    return rows;
  }
}

export const platformAnalyticsService = PlatformAnalyticsService;
