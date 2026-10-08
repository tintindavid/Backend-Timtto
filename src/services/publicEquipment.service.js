'use strict';
import { EquipmentQr } from '../models/equipmentQr.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Report } from '../models/report.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { PUBLIC_HISTORY_HARD_LIMIT } from '../constants/equipmentQr.constants.js';

/**
 * publicEquipmentService — NO auth, NO tenant header/query trust (design D6).
 *
 * `getHistory(qrToken)` resolves `tenantId` EXCLUSIVELY from the
 * `EquipmentQr` document matched by `qrToken`, then uses it to scope every
 * subsequent query (equipo, cliente, sede, reports). The returned DTO is
 * built field-by-field (design D5) — it NEVER passes a Mongoose doc/`.lean()`
 * object straight through, so there is no risk of leaking `tenantId`,
 * `createdBy`, user `_id`/`email`, `evidencias`, `storagePath`, or
 * `clientReview` by omission when the schema changes later.
 */
export class PublicEquipmentService {
  async getHistory(qrToken) {
    if (!qrToken || typeof qrToken !== 'string') {
      throw new ApiError(404, 'No encontrado', 'NOT_FOUND');
    }

    // Step 1: resolve by qrToken, active + not soft-deleted. Same 404 for
    // unknown AND inactive tokens (spec: "no distinction").
    const qr = await EquipmentQr.findOne({ qrToken, active: true }).lean();
    if (!qr) {
      throw new ApiError(404, 'No encontrado', 'NOT_FOUND');
    }

    // tenantId NEVER comes from anywhere else from this point on (design D6).
    const tenantId = qr.tenantId;
    const equipoId = qr.equipoId;

    // Step 2: equipo must exist, not be soft-deleted, and belong to this tenant.
    const equipo = await EquipoItem.findOne({ _id: equipoId, tenantId }).lean();
    if (!equipo) {
      throw new ApiError(404, 'No encontrado', 'NOT_FOUND', { equipoId: equipoId?.toString(), tenantId });
    }

    // Step 3: cliente/sede display data + up to PUBLIC_HISTORY_HARD_LIMIT reports.
    const [cliente, sede, reports] = await Promise.all([
      Customer.findOne({ _id: equipo.ClienteId, tenantId }).select('Razonsocial Logo').lean(),
      Sedes.findOne({ _id: equipo.SedeId, tenantId }).select('nombreSede').lean(),
      Report.find({ Equipo: equipo._id, tenantId, isDeleted: false })
        .sort({ fechaFinalizdo: -1, FechaCreacion: -1 })
        .limit(PUBLIC_HISTORY_HARD_LIMIT)
        .select('consecutivo tipoMtto fechaFinalizdo FechaCreacion fechaProcesado estadoOperativo procesadoPor estado observacionEstadoFinal observacion')
        .populate('ResponsableMtto', 'firstName lastName')
        .lean(),
    ]);

    // Step 4: build the whitelisted DTO field-by-field (design D5). Nothing
    // here is a passthrough of a Mongoose/.lean() object.
    const historial = reports.map((r) => {
      const observacion = r.observacionEstadoFinal || r.observacion || null;
      const responsableNombre = r.procesadoPor?.snapshotName
        || [r.ResponsableMtto?.firstName, r.ResponsableMtto?.lastName].filter(Boolean).join(' ')
        || null;
      return {
        consecutivo: r.consecutivo || null,
        tipoMtto: r.tipoMtto || null,
        fecha: r.fechaFinalizdo || r.fechaProcesado || r.FechaCreacion || null,
        estado: r.estado || null,
        estadoOperativoFinal: r.estadoOperativo || null,
        responsable: responsableNombre,
        observacion,
        tieneObservacion: Boolean(observacion),
      };
    });

    // Compute ultimoMtto from the actual history (most recent CLOSED report)
    // so the summary tile stays consistent with what the user sees in the
    // history tab (fix #3). Fall back to the equipo's cached value only when
    // the history has nothing closed yet.
    const ultimoMttoFromHistory = historial.find(
      (h) => h.fecha && (h.estado === 'Cerrado' || h.estado === 'Procesado')
    )?.fecha || null;

    const equipoDto = {
      item: equipo.item || null,
      marca: equipo.Marca || null,
      modelo: equipo.Modelo || null,
      serie: equipo.Serie || null,
      inventario: equipo.Inventario || null,
      ubicacion: equipo.Ubicacion || null,
      estadoOperativo: equipo.EstadoOperativo || null,
      ultimoMtto: ultimoMttoFromHistory || equipo.UltimoMtto || null,
      proximoMtto: equipo.ProximoMtto || null,
      // Cronograma 2026: months the equipo is scheduled for maintenance plus
      // the months already executed (fix #4). Both arrays are plain strings
      // (e.g. "Enero", "Febrero") — the FE renders a 12-chip timeline.
      mesesMtto: Array.isArray(equipo.mesesMtto) ? equipo.mesesMtto : [],
      mesesMttoRealizados: Array.isArray(equipo.mesesMttoRealizados)
        ? equipo.mesesMttoRealizados.map((m) => ({
            mes: m?.mes || null,
            fecha: m?.fecha || null,
            consecutivo: m?.consecutivo || null,
          }))
        : [],
    };

    const clienteDto = cliente ? { nombre: cliente.Razonsocial || null, logo: cliente.Logo || null } : null;
    const sedeDto = sede ? { nombre: sede.nombreSede || null } : null;

    return {
      dto: { equipo: equipoDto, cliente: clienteDto, sede: sedeDto, historial },
      // Internal-only — used by the controller for structured logging.
      // NEVER merged into `dto` / sent to the client.
      _internal: { equipoId: equipo._id.toString(), tenantId },
    };
  }
}

export const publicEquipmentService = new PublicEquipmentService();
