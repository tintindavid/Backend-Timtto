import mongoose from 'mongoose';
import { Report } from '../models/report.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { assertCapability } from '../config/tenantCapabilities.config.js';
import { assertCustomerIsProvider } from '../utils/assertCustomerKind.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import { MESES_ARRAY } from '../utils/meses.util.js';
import { sanitizeVerificationParams } from '../utils/verificationParams.util.js';
import { nameShort } from '../utils/nameShort.util.js';
import { logger } from '../config/logger.config.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { historyService } from './history.service.js';
import { aplicarEstadoDeServicio } from './estadoOperativoServicio.service.js';
import { calcularProximoMtto } from './report.service.js';

/**
 * Services done by a third party and loaded from the equipment record (reportes-externos-mp-mc).
 * They are ordinary `Report` documents flagged `origen: 'externo'`, closed, without a work order. Nothing of
 * the work-order flow (`ot.service`, `reportService.procesar`) is touched: the equipment effects that
 * `procesar` has are reproduced here, with the same helpers, for the external case.
 */

const CAPABILITY_MESSAGE = 'Tu organización no tiene habilitado el registro de servicios de terceros.';
const WARNING_OUT_OF_SCHEDULE = 'MES_FUERA_DE_CRONOGRAMA';
const WARNING_OTHER_YEAR = 'SERVICIO_DE_OTRO_ANIO';

const utcDay = (value) => {
  const d = new Date(value);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const lowerMonths = (list) => (Array.isArray(list) ? list.map((m) => String(m).toLowerCase()) : []);

async function loadEquipo(tenantId, equipoId) {
  if (!mongoose.isValidObjectId(equipoId)) throw new ApiError(404, 'Equipo no encontrado', 'NOT_FOUND');
  const equipo = await EquipoItem.findOne(applyTenantFilter({ _id: equipoId, isDeleted: false }, tenantId))
    .populate('ItemId', 'Nombre')
    .populate('SedeId', 'nombreSede')
    .populate('Servicio', 'nombre')
    .lean();
  if (!equipo) throw new ApiError(404, 'Equipo no encontrado', 'NOT_FOUND');
  return equipo;
}

function buildSnapshot(eq) {
  return {
    ItemText: eq?.ItemId?.Nombre || eq?.item || '',
    Marca: eq?.Marca || '',
    Modelo: eq?.Modelo || '',
    Sede: eq?.SedeId?.nombreSede || '',
    Serie: eq?.Serie || '',
    Inventario: eq?.Inventario || '',
    Servicio: eq?.Servicio?.nombre || '',
    Ubicacion: eq?.Ubicacion || '',
    MesesMtto: Array.isArray(eq?.mesesMtto) ? eq.mesesMtto : [],
    protocoloMtto: eq?.ProtocoloId || '',
  };
}

/**
 * Equipment effects of a new external report. Mirrors `reportService.procesar`:
 *  - operative state through the history helper (source 'report-external');
 *  - preventive only: `mesesMttoRealizados`, `UltimoMtto`, `UltimoConsecutivoMtto`, `ProximoMtto`.
 * A service dated before the equipment's last maintenance (or last state change) is kept as history: its month
 * is recorded but the current values are not moved back. `mesesMttoRealizados` stores the month WITHOUT a year and
 * the schedule reads it as "done this year", so a service of another year never marks a month: it is kept as a
 * report (and as `UltimoMtto` when it is the most recent) and the response warns about it.
 * @returns {Promise<string[]>} warnings
 */
async function applyEquipoEffects({ equipo, report, fecha, esPreventivo, estadoOperativo, tenantId, panelUser }) {
  const warnings = [];
  const mesAbrev = MESES_ARRAY[fecha.getUTCMonth() + 1];
  const programados = lowerMonths(equipo.mesesMtto);

  // The state follows the last service by date; the history keeps the date of the service (see
  // estadoOperativoServicio.service for the rule and for what never blocks a service).
  await aplicarEstadoDeServicio({
    equipo, estadoOperativo, fecha, source: 'report-external', reportId: report._id, panelUser, tenantId,
  });

  if (!esPreventivo) return warnings;

  const otroAnio = fecha.getUTCFullYear() !== new Date().getUTCFullYear();
  const scheduleIsOlder = equipo.UltimoMtto && utcDay(fecha) < utcDay(equipo.UltimoMtto);
  const set = {};
  if (!scheduleIsOlder) {
    set.UltimoMtto = fecha;
    set.UltimoConsecutivoMtto = report.consecutivo;
    if (programados.length > 0 && !otroAnio) set.ProximoMtto = calcularProximoMtto(mesAbrev, programados);
  }
  const update = {};
  if (!otroAnio) update.$push = { mesesMttoRealizados: { fecha, mes: mesAbrev, consecutivo: report.consecutivo } };
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(update).length === 0) {
    warnings.push(WARNING_OTHER_YEAR);
    return warnings;
  }

  const updated = await EquipoItem.findOneAndUpdate(applyTenantFilter({ _id: equipo._id }, tenantId), update, {
    new: true,
    runValidators: true,
  });
  if (!updated) throw new ApiError(404, 'Equipo no encontrado', 'NOT_FOUND');

  if (otroAnio) warnings.push(WARNING_OTHER_YEAR);
  else if (programados.length > 0 && !programados.includes(mesAbrev)) warnings.push(WARNING_OUT_OF_SCHEDULE);
  return warnings;
}

export const reporteExternoService = {
  /**
   * Takes the state-history entries of a deleted external report out of the history so they stop deciding which
   * service is the last one. When the deleted service had set the current state (its entry was the last one),
   * the state goes back to what the previous entry left (or to the `from` of the removed entry).
   */
  async undoEstadoDeServicio({ tenantId, equipoId, reportId }) {
    try {
      const equipo = await EquipoItem.findOne(applyTenantFilter({ _id: equipoId }, tenantId)).lean();
      const history = equipo?.estadoOperativoHistory || [];
      const own = history.filter((h) => h.reportId && String(h.reportId) === String(reportId) && h.source === 'report-external');
      if (own.length === 0) return;
      const remaining = history.filter((h) => !own.includes(h));
      const lastWasOwn = own.includes(history[history.length - 1]);
      const update = { $pull: { estadoOperativoHistory: { reportId, source: 'report-external' } } };
      if (lastWasOwn) {
        const previousEntry = remaining[remaining.length - 1];
        const restored = previousEntry?.to || own[0].from;
        if (restored) update.$set = { EstadoOperativo: restored };
      }
      await EquipoItem.findOneAndUpdate(applyTenantFilter({ _id: equipoId }, tenantId), update);
    } catch (err) {
      logger.warn('No se pudo deshacer el estado operativo del servicio externo eliminado', { err: String(err) });
    }
  },

  /**
   * @param {object} args
   * @param {string} args.tenantId
   * @param {string} args.equipoId
   * @param {object} args.dto validated body (see reporteExterno.dto.js)
   * @param {{ buffer: Buffer, originalname: string, mimetype: string }} [args.file]
   * @param {object} [args.capabilities] req.tenant.capabilities
   * @param {object} [args.panelUser] req.user
   * @returns {Promise<{ report: object, warnings: string[] }>}
   */
  async create({ tenantId, equipoId, dto, file = null, capabilities, panelUser = null }) {
    requireTenant(tenantId);
    assertCapability(capabilities, 'registersExternal', CAPABILITY_MESSAGE);

    const esPreventivo = dto.tipoMtto === 'Preventivo';
    if (!esPreventivo && Array.isArray(dto.verificationParam) && dto.verificationParam.length > 0) {
      throw new ApiError(400, 'Los parámetros de verificación solo aplican a mantenimientos preventivos', 'VALIDATION_ERROR', {
        field: 'verificationParam',
      });
    }

    const equipo = await loadEquipo(tenantId, equipoId);

    const provider = await assertCustomerIsProvider(dto.proveedorId, tenantId);
    const proveedorNombre = provider ? provider.Razonsocial : (dto.proveedor || '').trim();
    if (!proveedorNombre) throw new ApiError(400, 'Indica el proveedor del servicio', 'VALIDATION_ERROR', { field: 'proveedor' });

    const fecha = new Date(dto.fecha);
    if (Number.isNaN(fecha.getTime()) || utcDay(fecha) > utcDay(new Date())) {
      throw new ApiError(400, 'La fecha del servicio no puede ser futura', 'VALIDATION_ERROR', { field: 'fecha' });
    }
    const verificationParam = esPreventivo ? sanitizeVerificationParams(dto.verificationParam) : [];

    // Upload before writing (a rejected file leaves nothing behind); compensated below if anything fails.
    const documento = file
      ? await firebaseStorageService.uploadReporteExternoDocumento(file.buffer, file.originalname, file.mimetype, {
        clienteId: String(equipo.ClienteId),
        equipoId: String(equipo._id),
      })
      : null;

    let report = null;
    try {
      const seq = await getNextSequence(tenantId, 'REPORT');
      const consecutivo = formatConsecutivo('R', seq, 6);
      const userId = panelUser?.userId ?? panelUser?._id ?? null;

      report = await Report.create({
        tenantId,
        Equipo: equipo._id,
        ClienteId: equipo.ClienteId,
        consecutivo,
        estado: 'Cerrado',
        FechaCreacion: new Date(),
        fechaProcesado: fecha,
        fechaFinalizdo: fecha,
        tipoMtto: dto.tipoMtto,
        estadoOperativo: dto.estadoOperativo,
        observacion: dto.observacion || undefined,
        verificationParam,
        equipoSnapshot: buildSnapshot(equipo),
        procesadoPor: { userId, snapshotName: panelUser ? (nameShort(panelUser) || 'Usuario') : 'Sistema', fechaProceso: new Date() },
        origen: 'externo',
        externo: {
          proveedor: proveedorNombre,
          proveedorId: provider ? provider._id : null,
          consecutivoDocumento: dto.consecutivoDocumento || undefined,
          enlace: dto.enlace || undefined,
          documento: documento || undefined,
          registradoPor: userId,
        },
      });

      const warnings = await applyEquipoEffects({
        equipo, report, fecha, esPreventivo, estadoOperativo: dto.estadoOperativo, tenantId, panelUser,
      });

      await historyService.record({
        tenantId,
        resourceType: 'Report',
        resourceId: report._id,
        action: 'create-external',
        description: `Servicio externo ${report.consecutivo} (${dto.tipoMtto}) registrado, proveedor ${proveedorNombre}`,
        userId,
        userName: panelUser?.userName || panelUser?.email || 'Sistema',
        changes: { origen: { from: null, to: 'externo' } },
      });

      logger.info('Reporte externo creado', { tenantId, reportId: String(report._id), equipoId: String(equipo._id), tipoMtto: dto.tipoMtto });
      return { report, warnings };
    } catch (err) {
      // Compensation: no half-registered service and no orphan file
      if (report) {
        try {
          await Report.findOneAndUpdate(applyTenantFilter({ _id: report._id }, tenantId), { $set: { isDeleted: true, deletedAt: new Date() } });
        } catch (cleanupErr) {
          logger.error('No se pudo revertir el reporte externo tras un error', { err: String(cleanupErr) });
        }
      }
      if (documento?.storagePath) await firebaseStorageService.deleteReporteExternoDocumento(documento.storagePath);
      if (err instanceof ApiError) throw err;
      logger.error('Error creando reporte externo:', err);
      throw new ApiError(500, 'Error registrando el servicio externo', 'CREATE_ERROR');
    }
  },

  /**
   * Deletes an external report: soft delete, takes its month out of `mesesMttoRealizados`, recomputes the last
   * and next maintenance from the entries that remain and deletes the attached document. The operative-state
   * history is kept (a correction is a new state change).
   */
  async remove({ tenantId, equipoId, id, capabilities, panelUser = null }) {
    requireTenant(tenantId);
    assertCapability(capabilities, 'registersExternal', CAPABILITY_MESSAGE);
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(equipoId)) {
      throw new ApiError(404, 'Reporte no encontrado', 'NOT_FOUND');
    }

    const report = await Report.findOne(applyTenantFilter({ _id: id, Equipo: equipoId }, tenantId))
      .select('+externo.documento.storagePath')
      .lean();
    if (!report) throw new ApiError(404, 'Reporte no encontrado', 'NOT_FOUND');
    if (report.origen !== 'externo') {
      throw new ApiError(400, 'Solo se pueden eliminar desde aquí los servicios registrados como externos', 'NOT_EXTERNAL_REPORT');
    }

    await Report.findOneAndUpdate(applyTenantFilter({ _id: id }, tenantId), { $set: { isDeleted: true, deletedAt: new Date() } });

    if (report.tipoMtto === 'Preventivo') {
      const equipo = await EquipoItem.findOne(applyTenantFilter({ _id: equipoId }, tenantId)).lean();
      if (equipo) {
        const remaining = (equipo.mesesMttoRealizados || []).filter((m) => m.consecutivo !== report.consecutivo);
        // External services of another year are not in `mesesMttoRealizados` but can be the last maintenance.
        const otherYears = await Report.find(applyTenantFilter({
          Equipo: equipoId, tipoMtto: 'Preventivo', origen: 'externo', isDeleted: false, _id: { $ne: report._id },
        }, tenantId)).select('consecutivo fechaFinalizdo').lean();
        const candidates = [
          ...remaining,
          ...otherYears
            .filter((r) => r.fechaFinalizdo)
            .map((r) => ({
              fecha: r.fechaFinalizdo,
              mes: MESES_ARRAY[new Date(r.fechaFinalizdo).getUTCMonth() + 1],
              consecutivo: r.consecutivo,
            })),
        ];
        const latest = candidates
          .filter((m) => m.fecha)
          .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
        const programados = lowerMonths(equipo.mesesMtto);

        // The last maintenance is recomputed only when this report was the one that set it. Otherwise (a backdated
        // service, or a legacy `UltimoMtto` with no entries) the current values are not ours to touch.
        const eraElUltimo = String(equipo.UltimoConsecutivoMtto || '') === String(report.consecutivo);
        const estabaEnMeses = (equipo.mesesMttoRealizados || []).length !== remaining.length;
        const set = { mesesMttoRealizados: remaining };
        const unset = {};
        if (eraElUltimo) {
          if (latest) {
            set.UltimoMtto = latest.fecha;
            set.UltimoConsecutivoMtto = latest.consecutivo;
            if (programados.length > 0 && latest.mes) set.ProximoMtto = calcularProximoMtto(latest.mes, programados);
          } else {
            unset.UltimoMtto = 1;
            unset.UltimoConsecutivoMtto = 1;
          }
        }
        if (eraElUltimo || estabaEnMeses) {
          const update = { $set: set };
          if (Object.keys(unset).length > 0) update.$unset = unset;
          await EquipoItem.findOneAndUpdate(applyTenantFilter({ _id: equipoId }, tenantId), update, { runValidators: true });
        }
      }
    }

    await this.undoEstadoDeServicio({ tenantId, equipoId, reportId: report._id });

    const storagePath = report.externo?.documento?.storagePath;
    if (storagePath) await firebaseStorageService.deleteReporteExternoDocumento(storagePath);

    await historyService.record({
      tenantId,
      resourceType: 'Report',
      resourceId: report._id,
      action: 'delete-external',
      description: `Servicio externo ${report.consecutivo || ''} eliminado`,
      userId: panelUser?.userId ?? null,
      userName: panelUser?.userName || panelUser?.email || 'Sistema',
    });

    logger.info('Reporte externo eliminado', { tenantId, reportId: String(report._id) });
    return { id: String(report._id) };
  },
};
