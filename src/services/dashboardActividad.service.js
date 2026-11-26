'use strict';

import mongoose from 'mongoose';
import { Report } from '../models/report.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { User } from '../models/user.model.js';
import { periodoResponse } from '../utils/dashboardPeriod.util.js';
import { round1 } from './dashboardSchedule.helpers.js';
import { loadExecutionTimes } from './dashboardTiempos.service.js';
import {
  reportBaseMatch, doneInPeriodMatch, hasExecution, unavailable, tipoMttoMatch, oid, OPEN_REPORT_ESTADOS,
} from './dashboard.common.js';

/**
 * Activity of users and item types (change: dashboard-por-tenant-indicadores, design D7/D8):
 * my figures, ranking (top 10) and completed reports by item type (top 10 + Otros).
 */

const RANKING_LIMIT = 10;
const ITEMS_LIMIT = 10;
const SIN_TIPO = 'Sin tipo';

export class DashboardActividadService {
  /** GET /dashboard/mis-cifras — the user is `ctx.userId` (token identity), never a client value. */
  async misCifras(ctx) {
    const periodo = periodoResponse(ctx.period);
    if (!hasExecution(ctx)) return { periodo, ...unavailable() };

    const empty = { periodo, disponible: true, abiertos: 0, realizados: 0, cancelados: 0, tiempoPromedioDias: null, truncado: false };
    if (!ctx.userId || !mongoose.Types.ObjectId.isValid(ctx.userId)) return empty;
    const me = oid(ctx.userId, 'userId');
    // The technician filter is replaced by the session user; the other filters keep applying.
    const meCtx = { ...ctx, filters: { ...ctx.filters, tecnicoId: ctx.userId } };

    const base = await reportBaseMatch(ctx);
    if (ctx.filters.tipoMtto) base.tipoMtto = tipoMttoMatch(ctx.filters.tipoMtto);
    const range = { $gte: ctx.period.inicio, $lt: ctx.period.fin };

    const [abiertos, realizados, cancelados, times] = await Promise.all([
      Report.countDocuments({ ...base, ResponsableMtto: me, estado: { $in: [...OPEN_REPORT_ESTADOS] } }),
      doneInPeriodMatch(meCtx).then((m) => Report.countDocuments(m)),
      Report.countDocuments({
        ...base,
        ResponsableMtto: me,
        estado: 'Cancelado',
        $or: [
          { fechaCancelacion: range },
          { fechaCancelado: range },
          { fechaCancelacion: null, fechaCancelado: null, FechaCreacion: range },
        ],
      }),
      doneInPeriodMatch(meCtx, { onlyProcesado: true }).then((m) => loadExecutionTimes(ctx, m)),
    ]);

    const dias = times.rows.map((r) => r.dias);
    return {
      periodo,
      disponible: true,
      abiertos,
      realizados,
      cancelados,
      tiempoPromedioDias: dias.length ? round1(dias.reduce((s, v) => s + v, 0) / dias.length) : null,
      truncado: times.truncado,
    };
  }

  /** GET /dashboard/ranking */
  async ranking(ctx) {
    const periodo = periodoResponse(ctx.period);
    if (!hasExecution(ctx)) return { periodo, ...unavailable() };

    const match = await doneInPeriodMatch(ctx);
    const rows = await Report.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$procesadoPor.userId', '$ResponsableMtto'] },
          realizados: { $sum: 1 },
          nombre: { $max: '$procesadoPor.snapshotName' },
        },
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { realizados: -1, _id: 1 } },
      { $limit: RANKING_LIMIT },
    ]);

    const missing = rows.filter((r) => !r.nombre).map((r) => r._id);
    const names = new Map();
    if (missing.length) {
      const users = await User.find({ tenantId: ctx.tenantId, _id: { $in: missing } }).select('fullName').lean();
      for (const u of users) names.set(String(u._id), u.fullName || '');
    }

    return {
      periodo,
      disponible: true,
      items: rows.map((r) => ({
        userId: String(r._id),
        nombre: r.nombre || names.get(String(r._id)) || 'Usuario',
        realizados: r.realizados,
      })),
    };
  }

  /** GET /dashboard/items */
  async items(ctx) {
    const periodo = periodoResponse(ctx.period);
    if (!hasExecution(ctx)) return { periodo, ...unavailable() };

    const match = await doneInPeriodMatch(ctx);
    const withText = await Report.aggregate([
      { $match: { ...match, 'equipoSnapshot.ItemText': { $nin: [null, ''] } } },
      { $group: { _id: '$equipoSnapshot.ItemText', cantidad: { $sum: 1 } } },
    ]);
    // Reports without a snapshot fall back to the equipment `item` (design D8).
    const withoutText = await Report.aggregate([
      { $match: { ...match, 'equipoSnapshot.ItemText': { $in: [null, ''] } } },
      { $group: { _id: '$Equipo', cantidad: { $sum: 1 } } },
    ]);

    const counts = new Map(withText.map((r) => [r._id, r.cantidad]));
    if (withoutText.length) {
      const ids = withoutText.map((r) => r._id).filter(Boolean);
      const equipos = ids.length
        ? await EquipoItem.find({ tenantId: ctx.tenantId, _id: { $in: ids } }).select('item').lean()
        : [];
      const itemById = new Map(equipos.map((e) => [String(e._id), e.item]));
      for (const r of withoutText) {
        const name = (r._id && itemById.get(String(r._id))) || SIN_TIPO;
        counts.set(name, (counts.get(name) || 0) + r.cantidad);
      }
    }

    const sorted = [...counts.entries()]
      .map(([tipo, cantidad]) => ({ tipo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.tipo.localeCompare(b.tipo));
    const top = sorted.slice(0, ITEMS_LIMIT);
    const rest = sorted.slice(ITEMS_LIMIT);
    if (rest.length) top.push({ tipo: 'Otros', cantidad: rest.reduce((s, r) => s + r.cantidad, 0) });

    return { periodo, disponible: true, total: sorted.reduce((s, r) => s + r.cantidad, 0), items: top };
  }
}

export const dashboardActividadService = new DashboardActividadService();
