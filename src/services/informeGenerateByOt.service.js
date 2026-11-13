'use strict';
import { Customer } from '../models/customer.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { classifyReportForOt, formatDate, toRepuestoRow } from './informeReport.helpers.js';
import { sanitizeRichText } from '../utils/sanitizeRichText.util.js';

const SIN_SEDE = '(Sin sede)';
const SIN_SERVICIO = '(Sin servicio)';

// ─── Helpers (module-private) ────────────────────────────────────────────────

function resolveSedeServicio(report, equipo) {
  const snap = report.equipoSnapshot || {};
  const sede = snap.Sede || equipo?.SedeId?.nombreSede || SIN_SEDE;
  const servicio = snap.Servicio || equipo?.Servicio?.nombre || SIN_SERVICIO;
  return { sede, servicio };
}

/** Observation text of a report; a cancelled one leads with its cancellation reason. */
function buildObservacionTexto(report) {
  const obs = (report.observacion || '').trim();
  if (report.estado !== 'Cancelado') return obs;
  const motivo = (report.motivoCancelacion || '').trim();
  const parts = [`Cancelado${motivo ? `. Motivo: ${motivo}` : ''}`];
  if (obs) parts.push(obs);
  return parts.join('. ');
}

function toOtReportRow(report, equipo) {
  const snap = report.equipoSnapshot || {};
  const { sede, servicio } = resolveSedeServicio(report, equipo);
  const estadoOperativo = report.EstadoOperativo ?? equipo?.EstadoOperativo ?? 'Operativo';

  return {
    reporteId: report._id?.toString() || '',
    consecutivo: report.consecutivo || report._id?.toString() || '',
    otId: report.orden?._id?.toString() || '',
    otConsecutivo: report.orden?.Consecutivo || '',
    equipoId: equipo?._id?.toString() || '',
    equipoNombre: snap.ItemText || equipo?.item || equipo?.ItemId?.Nombre || '',
    marca: snap.Marca || equipo?.Marca || '',
    modelo: snap.Modelo || equipo?.Modelo || '',
    serie: snap.Serie || equipo?.Serie || '',
    inventario: snap.Inventario || equipo?.Inventario || '',
    ubicacion: snap.Ubicacion || equipo?.Ubicacion || '',
    sede,
    servicio,
    estadoReporte: classifyReportForOt(report),
    estadoOperativo,
    fechaProgramada: formatDate(report.FechaCreacion),
    fechaRealizado: formatDate(report.fechaProcesado || report.fechaFinalizdo),
    tecnico: report.ResponsableMtto?.fullName || '',
  };
}

// Only plain http(s) URLs are ever offered / rendered as photos (no data:, javascript:, file:, relative)
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

const resolveEquipoNombre = (report, equipo) =>
  report.equipoSnapshot?.ItemText || equipo?.item || equipo?.ItemId?.Nombre || '';

function toFotoItem(report, evidencia, equipoNombre) {
  return {
    evidenciaId: evidencia._id?.toString() || '',
    url: evidencia.url || '',
    nombre: evidencia.nombre || '',
    descripcion: evidencia.descripcion || '',
    reporteId: report._id?.toString() || '',
    reporteConsecutivo: report.consecutivo || report._id?.toString() || '',
    equipoNombre: equipoNombre || '',
  };
}

function computeCumplimiento(reports) {
  const totalReportes = reports.length;
  const totalCancelados = reports.filter(r => classifyReportForOt(r) === 'Cancelado').length;
  const totalCumplidos = reports.filter(r => classifyReportForOt(r) === 'Cumplido').length;
  const totalPendientes = reports.filter(r => classifyReportForOt(r) === 'Pendiente').length;
  const denom = totalReportes - totalCancelados;
  const cumplimiento = denom > 0 ? Math.round((totalCumplidos / denom) * 1000) / 10 : '—';
  return { totalReportes, totalCancelados, totalCumplidos, totalPendientes, cumplimiento };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class InformeGenerateByOtService {
  /**
   * Aggregates a compliance informe scoped to an explicit list of OTs of a
   * single client. See openspec/changes/informes-por-ot-tab-con-firma-y-cumplimiento.
   *
   * @param {{clienteId: string, otIds: string[], observacionGeneral?: string}} params
   * @param {string} tenantId
   * @param {object} currentUser - { fullName, fileFirma, _id }
   * @param {object} tenant      - { name }
   * @returns {Promise<object>} InformePorOtPayload
   */
  async generateByOt({ clienteId, otIds, observacionGeneral = '', fotoIds = [], observacionesAdicionalesHtml = '' }, tenantId, currentUser = {}, tenant = {}) {
    logger.info('InformeGenerateByOt.generateByOt', { clienteId, otIds: otIds.length, tenantId });

    // 1. Parallel queries
    const [customer, ots, reports, equipos, tenantDoc] = await Promise.all([
      Customer.findOne(applyTenantFilter({ _id: clienteId }, tenantId)).lean(),

      OT.find(applyTenantFilter({ _id: { $in: otIds }, ClienteId: clienteId }, tenantId))
        .select('Consecutivo TipoServicio FechaCreacion EstadoOt ClienteId')
        .lean(),

      Report.find(applyTenantFilter({ ClienteId: clienteId, orden: { $in: otIds } }, tenantId))
        .populate('ResponsableMtto', 'fullName')
        .populate('orden', 'Consecutivo TipoServicio EstadoOt')
        .lean(),

      EquipoItem.find(applyTenantFilter({ ClienteId: clienteId }, tenantId))
        .populate('ItemId', 'Nombre')
        .populate('SedeId', 'nombreSede')
        .populate('Servicio', 'nombre')
        .lean(),

      Tenant.findOne({ tenantId, isDeleted: false }).lean(),
    ]);

    // Controllers stub `tenant = {}`; hydrate from the freshly-fetched doc.
    tenant = {
      ...tenant,
      name: tenant.name || tenantDoc?.name || '',
      logoUrl: tenant.logoUrl || tenantDoc?.logoUrl || null,
      direccion: tenant.direccion || tenantDoc?.direccion || '',
      ciudad: tenant.ciudad || tenantDoc?.ciudad || '',
      departamento: tenant.departamento || tenantDoc?.departamento || '',
      telefono: tenant.telefono || tenantDoc?.telefono || '',
      email: tenant.email || tenantDoc?.email || '',
    };

    if (!customer) {
      throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND', { clienteId });
    }

    // 2. Cross-scope guard: every requested otId must resolve to an OT that
    // belongs to this tenant AND this clienteId. If any otId fails either
    // condition, applyTenantFilter/ClienteId already excluded it from `ots`,
    // so a length mismatch is sufficient to detect the violation.
    if (ots.length !== otIds.length) {
      throw new ApiError(400, 'Alguna OT no pertenece al cliente/tenant', 'INVALID_OT_SCOPE', {
        clienteId, requested: otIds.length, found: ots.length,
      });
    }

    const equipoMap = new Map(equipos.map(eq => [eq._id.toString(), eq]));

    // 2b. Photos: resolve each requested evidencia id ONLY against the reports already in scope.
    // The client never supplies a URL; an unknown / out-of-scope id aborts the whole report.
    const fotos = [];
    if (fotoIds.length) {
      const evidenciaIndex = new Map();
      for (const report of reports) {
        const equipo = equipoMap.get(report.Equipo?.toString());
        const equipoNombre = resolveEquipoNombre(report, equipo);
        for (const ev of report.evidencias || []) {
          if (ev?._id && isHttpUrl(ev.url)) evidenciaIndex.set(ev._id.toString(), toFotoItem(report, ev, equipoNombre));
        }
      }
      for (const id of fotoIds) {
        const foto = evidenciaIndex.get(String(id));
        if (!foto) {
          throw new ApiError(400, 'Alguna foto no pertenece a los reportes del informe', 'INVALID_FOTO_SCOPE', {
            clienteId, requested: fotoIds.length,
          });
        }
        fotos.push(foto);
      }
    }
    const observacionesAdicionales = sanitizeRichText(observacionesAdicionalesHtml);

    const reportIds = reports.map(r => r._id);

    // 3. Repuestos of the reports in scope
    const repuestosData = reportIds.length
      ? await Repuestos.find(applyTenantFilter({ ReporteSolicitudId: { $in: reportIds } }, tenantId))
          .populate('EquipoId', 'item Marca')
          .lean()
      : [];

    const repuestosByReportId = new Map();
    for (const rep of repuestosData) {
      const key = rep.ReporteSolicitudId?.toString();
      if (!key) continue;
      if (!repuestosByReportId.has(key)) repuestosByReportId.set(key, []);
      repuestosByReportId.get(key).push(rep);
    }

    // 4. Build rows + group Sede -> Servicio
    const sectionMap = new Map(); // sede -> Map(servicio -> { reports: [], rows: [] })
    for (const report of reports) {
      const equipo = equipoMap.get(report.Equipo?.toString());
      const row = toOtReportRow(report, equipo);
      const { sede, servicio } = row;

      if (!sectionMap.has(sede)) sectionMap.set(sede, new Map());
      const servicioMap = sectionMap.get(sede);
      if (!servicioMap.has(servicio)) servicioMap.set(servicio, { reports: [], rows: [] });
      const bucket = servicioMap.get(servicio);
      bucket.reports.push(report);
      bucket.rows.push(row);
    }

    const sedesOrdenadas = [...sectionMap.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    const secciones = [];
    for (const sede of sedesOrdenadas) {
      const servicioMap = sectionMap.get(sede);
      const serviciosOrdenados = [...servicioMap.keys()].sort((a, b) => a.localeCompare(b, 'es'));
      for (const servicio of serviciosOrdenados) {
        const bucket = servicioMap.get(servicio);
        const { totalReportes, totalCancelados, totalCumplidos, totalPendientes, cumplimiento } =
          computeCumplimiento(bucket.reports);

        const repuestos = [];
        for (const report of bucket.reports) {
          const reps = repuestosByReportId.get(report._id.toString()) || [];
          for (const rep of reps) {
            const qty = rep.Cantidad || rep.CantidadInstalacion || 0;
            const unit = rep.PrecioRepuesto || 0;
            repuestos.push({
              reporteId: report._id?.toString() || '',
    reporteConsecutivo: report.consecutivo || report._id?.toString() || '',
              equipo: rep.EquipoId?.item || rep.EquipoId?.Marca || '',
              repuesto: rep.nombre || '',
              cantidad: qty,
              estado: rep.EstadoSolicitud || '',
              precio: unit * (rep.CantidadInstalacion || 1),
              fecha: formatDate(rep.FechaInstalacion || rep.FechaSolicitud),
              observacion: rep.observacion || '',
            });
          }
        }

        secciones.push({
          sede,
          servicio,
          cumplimientoPct: cumplimiento === '—' ? null : cumplimiento,
          totalReportes,
          totalCancelados,
          totalCumplidos,
          totalPendientes,
          reportes: bucket.rows,
          repuestos,
        });
      }
    }

    // 5. Observaciones — one per report with a non-empty observacion or, when
    // the report was cancelled, its cancellation reason (so the reader can see why).
    const observacionesReportes = reports
      .map(r => ({ r, texto: buildObservacionTexto(r) }))
      .filter(({ texto }) => texto)
      .map(({ r, texto }) => {
        const equipo = equipoMap.get(r.Equipo?.toString());
        return {
          consecutivo: r.consecutivo || r._id?.toString() || '',
          estadoOperativo: r.EstadoOperativo ?? equipo?.EstadoOperativo ?? 'Operativo',
          observacion: texto,
        };
      });

    // 6. Global KPIs
    const global = computeCumplimiento(reports);
    const totalCorrectivos = reports.filter(r => r.tipoMtto === 'Correctivo').length;
    const totalRepuestosSolicitados = repuestosData.length;
    const totalRepuestosInstalados = repuestosData.filter(r => r.EstadoSolicitud === 'Instalado').length;
    const costoTotalRepuestos = repuestosData
      .filter(r => r.EstadoSolicitud === 'Instalado')
      .reduce((s, r) => s + ((r.PrecioRepuesto || 0) * (r.CantidadInstalacion || 1)), 0);
    const totalMinutos = reports.reduce((s, r) => s + (r.duracion ?? 45), 0);
    const horasServicio = Math.round((totalMinutos / 60) * 10) / 10;

    // 7. Structured log
    logger.info('informe.porOt.generated', {
      tenantId,
      clienteId,
      otCount: otIds.length,
      reportsCount: reports.length,
      generatedBy: currentUser._id,
    });

    return {
      meta: {
        clienteId: clienteId.toString(),
        clienteNombre: customer.Razonsocial,
        clienteNit: customer.Nit != null ? String(customer.Nit) : '',
        clienteCiudad: customer.Ciudad || '',
        clienteDepartamento: customer.Departamento || '',
        clienteDireccion: customer.Direccion || '',
        clienteEmail: customer.Email || '',
        clienteTelefono: customer.TelContacto || '',
        clienteContacto: customer.UserContacto || '',
        clienteLogo: customer.Logo || null,
        tenantNombre: tenant.name || '',
        tenantLogo: tenant.logoUrl || null,
        tenantDireccion: tenant.direccion || '',
        tenantCiudad: tenant.ciudad || '',
        tenantDepartamento: tenant.departamento || '',
        tenantTelefono: tenant.telefono || '',
        tenantEmail: tenant.email || '',
        fechaGeneracion: new Date().toISOString(),
        responsableNombre: currentUser.fullName || '',
        responsableFirmaUrl: currentUser.fileFirma ?? null,
        otsSeleccionadas: ots.map(ot => ({
          otId: ot._id?.toString() || '',
          consecutivo: ot.Consecutivo || '',
          tipoServicio: ot.TipoServicio || '',
          fechaCreacion: formatDate(ot.FechaCreacion),
          estadoOt: ot.EstadoOt || '',
        })),
      },
      kpis: {
        cumplimientoPct: global.cumplimiento === '—' ? null : global.cumplimiento,
        totalReportes: global.totalReportes - global.totalCancelados,
        cumplidos: global.totalCumplidos,
        pendientes: global.totalPendientes,
        cancelados: global.totalCancelados,
        correctivos: totalCorrectivos,
        repuestosInstalados: totalRepuestosInstalados,
        costoTotal: costoTotalRepuestos,
        horasServicio,
      },
      secciones,
      observacionesReportes,
      observacionGeneral,
      fotos,
      ...(observacionesAdicionales ? { observacionesAdicionalesHtml: observacionesAdicionales } : {}),
    };
  }

  /**
   * Paginated list of candidate photos (Report.evidencias) of the reports in scope. Same scope
   * guard as the informe: customer must exist and every otId must belong to the tenant AND the client.
   * Also returns `reportes`: ALL reports in scope with at least one usable photo (for the filter dropdown).
   *
   * @param {{clienteId: string, otIds: string[], reporteId?: string, search?: string, page?: number, limit?: number}} params
   * @param {string} tenantId
   * @returns {Promise<{items: object[], reportes: object[], total: number, page: number, limit: number, hasMore: boolean}>}
   */
  async listEvidenciasByOt({ clienteId, otIds, reporteId, search = '', page = 1, limit = 24 }, tenantId) {
    const [customer, ots, reports, equipos] = await Promise.all([
      Customer.findOne(applyTenantFilter({ _id: clienteId }, tenantId)).lean(),
      OT.find(applyTenantFilter({ _id: { $in: otIds }, ClienteId: clienteId }, tenantId)).select('_id').lean(),
      Report.find(applyTenantFilter({ ClienteId: clienteId, orden: { $in: otIds } }, tenantId))
        .select('consecutivo Equipo equipoSnapshot.ItemText evidencias._id evidencias.url evidencias.nombre evidencias.descripcion')
        .lean(),
      EquipoItem.find(applyTenantFilter({ ClienteId: clienteId }, tenantId))
        .select('item ItemId')
        .populate('ItemId', 'Nombre')
        .lean(),
    ]);

    if (!customer) {
      throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND', { clienteId });
    }
    if (ots.length !== otIds.length) {
      throw new ApiError(400, 'Alguna OT no pertenece al cliente/tenant', 'INVALID_OT_SCOPE', {
        clienteId, requested: otIds.length, found: ots.length,
      });
    }

    const equipoMap = new Map(equipos.map(eq => [eq._id.toString(), eq]));
    const label = (r) => String(r.consecutivo || r._id?.toString() || '');
    const sorted = [...reports].sort((a, b) => label(a).localeCompare(label(b), 'es', { numeric: true }));

    // Reports in scope with at least one usable photo (full list, independent of filters/pagination)
    const withPhotos = sorted
      .map(r => ({ report: r, evidencias: (r.evidencias || []).filter(ev => ev?._id && isHttpUrl(ev.url)) }))
      .filter(x => x.evidencias.length);

    const reportes = withPhotos.map(({ report }) => ({
      reporteId: report._id?.toString() || '',
      consecutivo: label(report),
      equipoNombre: resolveEquipoNombre(report, equipoMap.get(report.Equipo?.toString())),
    }));

    // reporteId outside scope simply yields no rows (compared against reports already in scope)
    const needle = String(search || '').trim().toLowerCase();
    const items = [];
    for (const { report, evidencias } of withPhotos) {
      if (reporteId && report._id?.toString() !== String(reporteId)) continue;
      const equipoNombre = resolveEquipoNombre(report, equipoMap.get(report.Equipo?.toString()));
      if (needle && !equipoNombre.toLowerCase().includes(needle) && !label(report).toLowerCase().includes(needle)) continue;
      for (const ev of evidencias) items.push(toFotoItem(report, ev, equipoNombre));
    }

    const total = items.length;
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit),
      reportes,
      total,
      page,
      limit,
      hasMore: start + limit < total,
    };
  }
}

export const informeGenerateByOtService = new InformeGenerateByOtService();
