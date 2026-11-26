'use strict';
import { successResponse } from '../utils/apiResponse.util.js';
import { buildBusquedaContext } from '../utils/busquedaContext.util.js';
import { busquedaEquiposService } from '../services/busquedaEquipos.service.js';
import { resumenEquipoService } from '../services/resumenEquipo.service.js';

/** Equipment search and summary (change: buscador-equipos). Binding only. */
export class BusquedaController {
  equipos = async (req, res, next) => {
    try {
      const data = await busquedaEquiposService.buscar(buildBusquedaContext(req), req.query);
      res.json(successResponse(data, 'Equipos encontrados'));
    } catch (err) { next(err); }
  };

  resumen = async (req, res, next) => {
    try {
      const data = await resumenEquipoService.resumen(buildBusquedaContext(req), req.params.id);
      res.json(successResponse(data, 'Resumen del equipo recuperado exitosamente'));
    } catch (err) { next(err); }
  };
}

export const busquedaController = new BusquedaController();
