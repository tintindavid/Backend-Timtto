'use strict';
import { successResponse } from '../utils/apiResponse.util.js';
import { buildDashboardContext } from '../utils/dashboardContext.util.js';
import { dashboardCumplimientoService } from '../services/dashboardCumplimiento.service.js';
import { dashboardActividadService } from '../services/dashboardActividad.service.js';
import { dashboardTiemposService } from '../services/dashboardTiempos.service.js';
import { dashboardOperativosService } from '../services/dashboardOperativos.service.js';

/**
 * Dashboard endpoints (change: dashboard-por-tenant-indicadores). Binding only: the tenant comes from
 * `req.tenantId` (never from the client) and every indicator is computed server-side by its service.
 */
function handler(compute, message) {
  return async (req, res, next) => {
    try {
      const ctx = buildDashboardContext(req);
      const data = await compute(ctx);
      res.json(successResponse(data, message));
    } catch (err) { next(err); }
  };
}

export class DashboardController {
  cumplimiento = handler((ctx) => dashboardCumplimientoService.cumplimiento(ctx), 'Cumplimiento recuperado exitosamente');
  equiposPeriodo = handler((ctx) => dashboardCumplimientoService.equiposPeriodo(ctx), 'Equipos del período recuperados exitosamente');
  misCifras = handler((ctx) => dashboardActividadService.misCifras(ctx), 'Mis cifras recuperadas exitosamente');
  ranking = handler((ctx) => dashboardActividadService.ranking(ctx), 'Ranking recuperado exitosamente');
  items = handler((ctx) => dashboardActividadService.items(ctx), 'Actividades por ítem recuperadas exitosamente');
  tiempos = handler((ctx) => dashboardTiemposService.tiempos(ctx), 'Tiempos de ejecución recuperados exitosamente');
  operativos = handler((ctx) => dashboardOperativosService.operativos(ctx), 'Indicadores operativos recuperados exitosamente');
  alertas = handler((ctx) => dashboardOperativosService.alertas(ctx), 'Alertas recuperadas exitosamente');
}

export const dashboardController = new DashboardController();
