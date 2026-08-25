'use strict';
import { Customer } from '../models/customer.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Report } from '../models/report.model.js';
import { Repuestos } from '../models/repuestos.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { monthRange, periodLabel, MONTH_LABELS, MONTHS } from '../utils/monthRange.util.js';
import {
  classifyReportForMeses as classifyReport,
  toReportRow,
  toEquipoResumen,
  toRepuestoRow,
} from './informeReport.helpers.js';

// ─── Service ─────────────────────────────────────────────────────────────────

class InformeGenerateService {
  /**
   * Aggregates all data needed for the maintenance report.
   * @param {string} clienteId
   * @param {string} mesDesde
   * @param {string} mesHasta
   * @param {string} tenantId
   * @param {object} currentUser  - { fullName }
   * @param {object} tenant       - { name }
   * @returns {Promise<object>}   - InformePayload
   */
  async generate(clienteId, mesDesde, mesHasta, tenantId, currentUser = {}, tenant = {}, observacionGeneral = '') {
    logger.info('InformeGenerate.generate', { clienteId, mesDesde, mesHasta, tenantId });

    const mesesSeleccionados = monthRange(mesDesde, mesHasta);
    const year = new Date().getFullYear();

    // Date range for report filtering: start of mesDesde to end of mesHasta
    const startDate = new Date(year, MONTHS.indexOf(mesDesde), 1);
    const endDate   = new Date(year, MONTHS.indexOf(mesHasta) + 1, 1); // exclusive: start of next month

    // 1. Customer + EquipoItems + Tenant in parallel
    const [customer, equipos, tenantDoc] = await Promise.all([
      Customer.findOne(applyTenantFilter({ _id: clienteId }, tenantId)).lean(),

      EquipoItem.find(
        applyTenantFilter({ ClienteId: clienteId, mesesMtto: { $in: mesesSeleccionados } }, tenantId)
      )
        .populate('ItemId', 'Nombre')
        .populate('SedeId', 'nombreSede')
        .populate('Servicio', 'nombre')
        .lean(),

      Tenant.findOne({ tenantId, isDeleted: false }).lean(),
    ]);

    // If the caller passed an explicit tenant object, honor it; otherwise
    // fall back to the freshly-fetched Tenant document. Ensures logoUrl +
    // name always land on meta even when the controller stubs `tenant = {}`.
    const effectiveTenant = tenantDoc || tenant || {};
    tenant = {
      ...tenant,
      name: tenant.name || effectiveTenant.name || '',
      logoUrl: tenant.logoUrl || effectiveTenant.logoUrl || null,
      direccion: tenant.direccion || effectiveTenant.direccion || '',
      ciudad: tenant.ciudad || effectiveTenant.ciudad || '',
      departamento: tenant.departamento || effectiveTenant.departamento || '',
      telefono: tenant.telefono || effectiveTenant.telefono || '',
      email: tenant.email || effectiveTenant.email || '',
    };

    if (!customer) {
      throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND', { clienteId });
    }
    if (!equipos.length) {
      throw new ApiError(400,
        'No se encontraron equipos con mantenimiento en el periodo seleccionado',
        'NO_EQUIPOS_FOUND',
        { clienteId, mesDesde, mesHasta }
      );
    }

    const equipoIds = equipos.map(e => e._id);

    // 2. Reports for those equipo-items within the selected period
    const reports = await Report.find(
      applyTenantFilter({
        ClienteId: clienteId,
        Equipo: { $in: equipoIds },
        FechaCreacion: { $gte: startDate, $lt: endDate },
      }, tenantId)
    )
      .populate('ResponsableMtto', 'fullName')
      .populate('orden', 'Consecutivo TipoServicio')
      .lean();

    const reportIds = reports.map(r => r._id);

    // 3. Repuestos for those reports
    const repuestosData = await Repuestos.find(
      applyTenantFilter({ ReporteSolicitudId: { $in: reportIds } }, tenantId)
    ).lean();

    // 5. Classify reports
    const preventivos = reports.filter(r => (r.tipoMtto || 'Preventivo') === 'Preventivo');
    const correctivos = reports.filter(r => r.tipoMtto === 'Correctivo');

    const totalProgramados       = preventivos.filter(r => classifyReport(r) === 'Programado').length;
    const totalRealizados        = preventivos.filter(r => classifyReport(r) === 'Realizado').length;
    const totalCorrectivos       = correctivos.length;
    const totalRepuestosSolic    = repuestosData.length;
    const totalRepuestosInst     = repuestosData.filter(r => r.EstadoSolicitud === 'Instalado').length;
    const costoTotalRepuestos    = repuestosData
      .filter(r => r.EstadoSolicitud === 'Instalado')
      .reduce((s, r) => s + ((r.PrecioRepuesto || 0) * (r.CantidadInstalacion || 1)), 0);
    const cumplimientoPreventivo = totalProgramados > 0
      ? Math.round((totalRealizados / (totalProgramados + totalRealizados)) * 1000) / 10
      : 0;

    const totalMinutos = reports.reduce((s, r) => s + (r.duracion ?? 45), 0);
    const horasServicio = Math.round((totalMinutos / 60) * 10) / 10;

    // 6. Build equipo summaries
    const equipoResumenes = equipos.map(eq => {
      const reportsForEq   = reports.filter(r => r.Equipo?.toString() === eq._id.toString());
      const repuestosForEq = repuestosData.filter(r => r.EquipoId?.toString() === eq._id.toString());
      return toEquipoResumen(eq, reportsForEq, repuestosForEq);
    });

    // 7. Observations — non-empty report observations
    const observaciones = reports
      .map(r => r.observacion)
      .filter(Boolean);

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
        periodoDesde: mesDesde,
        periodoHasta: mesHasta,
        periodoLabel: periodLabel(mesDesde, mesHasta, year),
        fechaGeneracion: new Date().toISOString(),
        mesesSeleccionados,
        tenantNombre: tenant.name || '',
        tenantLogo: tenant.logoUrl || null,
        tenantDireccion: tenant.direccion || '',
        tenantCiudad: tenant.ciudad || '',
        tenantDepartamento: tenant.departamento || '',
        tenantTelefono: tenant.telefono || '',
        tenantEmail: tenant.email || '',
        responsableNombre: currentUser.fullName || '',
        responsableFirmaUrl: currentUser.fileFirma ?? null,
      },
      kpis: {
        cumplimientoPreventivo,
        totalProgramados: totalProgramados + totalRealizados,
        totalRealizados,
        totalCorrectivos,
        totalRepuestosSolicitados: totalRepuestosSolic,
        totalRepuestosInstalados: totalRepuestosInst,
        costoTotalRepuestos,
        horasServicio,
      },
      preventivos: preventivos.map(toReportRow),
      correctivos: correctivos.map(toReportRow),
      equipos: equipoResumenes,
      repuestos: repuestosData.map(toRepuestoRow),
      costos: { repuestos: costoTotalRepuestos },
      observaciones,
      observacionGeneral,
    };
  }
}

export const informeGenerateService = new InformeGenerateService();
