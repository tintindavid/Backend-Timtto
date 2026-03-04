'use strict';

import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { logger } from '../config/logger.config.js';
import { ApiError } from '../utils/apiError.util.js';
import { SheetWork } from '../models/sheetwork.model.js';
import { Tenant } from '../models/tenant.model.js';
import { applyTenantFilter } from '../utils/tenant.util.js';

/**
 * Servicio para generar PDF de Hojas de Trabajo
 */
class SheetWorkPDFService {
  constructor() {
    this.pdfClient = new PDFMicroserviceClient();
  }

  /**
   * Genera PDF de una hoja de trabajo
   * @param {string} sheetWorkId - ID de la hoja de trabajo
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Buffer>} - Buffer del PDF generado
   */
  async generatePDF(sheetWorkId, tenantId) {
    try {
      logger.info('Iniciando generación de PDF de Hoja de Trabajo', { sheetWorkId, tenantId });

      // 1. Verificar salud del microservicio
      const healthy = await this.pdfClient.healthCheck();
      if (!healthy) {
        logger.error('Microservicio PDF no está disponible');
        throw new ApiError(503, 'Microservicio PDF no disponible', 'PDF_MICROSERVICE_OFFLINE');
      }

      // 2. Buscar hoja de trabajo populada
      const sheetWork = await SheetWork.findOne(
        applyTenantFilter({ _id: sheetWorkId }, tenantId)
      )
        .populate('clienteId')
        .populate({
          path: 'reports',
          populate: {
            path: 'Equipo',
            select: 'ItemText Marca Modelo Serie Servicio Ubicacion'
          }
        })
        .populate('otId', 'Consecutivo')
        .populate('responsable', 'firstName lastName')
        .lean();

      if (!sheetWork) {
        throw new ApiError(404, 'Hoja de Trabajo no encontrada', 'SHEETWORK_NOT_FOUND');
      }

      // 3. Buscar información del tenant
      const tenant = await Tenant.findOne({ tenantId }).lean();
      if (!tenant) {
        throw new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
      }

      console.log('tenantData: ', tenant);
      // 4. Generar HTML de la hoja de trabajo
      const html = this.generateHTML(sheetWork, tenant);

      // 5. Configurar opciones del PDF
    const pdfOptions = {
    format: 'A4',
    landscape: false,
    printBackground: true,
    margin: {
        top:    '0mm',
        right:  '0mm',
        bottom: '18mm',   // ← espacio para el footer en cada página
        left:   '0mm',
    },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',   // vacío — el header ya está en el HTML
    footerTemplate: `
        <div style="
        width: 100%;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 7px;
        color: #6C7480;
        padding: 3mm 8mm 2mm;
        border-top: 1px solid #DCDCE1;
        box-sizing: border-box;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        ">
        <!-- Línea azul inferior -->
        <div style="
            position: absolute;
            bottom: 0; left: 0; right: 0;
            height: 3px;
            background: #0056B3;
        "></div>

        <!-- Contacto del tenant -->
        <div style="line-height: 1.6;">
            <div>Ciudad: ${tenant.ciudad} - ${tenant.departamento}</div>
            <div>Dirección: ${tenant.direccion}</div>
            <div>${tenant.telefono ? `Tel: ${tenant.telefono}` : ''} ${tenant.email ? `| Email: ${tenant.email}` : ''}</div>
        </div>

        <!-- Número de página (clase especial de Puppeteer) -->
        <div style="font-size: 7.5px; font-weight: 700; color: #0056B3;">
            &nbsp;&nbsp;
            Página <span class="pageNumber"></span> de <span class="totalPages"></span>
        </div>
        </div>
    `,
    };


      logger.info('Generando PDF de Hoja de Trabajo con PDFMicroserviceClient');

      // 6. Generar PDF usando el cliente
      const pdfBuffer = await this.pdfClient.generatePDF(html, pdfOptions);

      logger.info('PDF de Hoja de Trabajo generado exitosamente', { sheetWorkId });
      return pdfBuffer;
    } catch (error) {
      logger.error('❌ Error generando PDF de Hoja de Trabajo:', {
        message: error.message,
        code: error.code || 'UNKNOWN',
        statusCode: error.statusCode || 500,
        sheetWorkId,
      });

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        500,
        `Error generando PDF de Hoja de Trabajo: ${error.message}`,
        'PDF_GENERATION_ERROR'
      );
    }
  }

  /**
   * Genera el HTML de la hoja de trabajo
   * @private
   */
  generateHTML(sheetWork, tenant) {
    // Preparar datos
    const data = this.prepareData(sheetWork, tenant);

    // Plantilla HTML
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Hoja de Trabajo - ${data.numeroHoja}</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>

<!-- TABLA ENVOLVENTE PARA REPETIR HEADER Y FOOTER -->
<table class="page-wrapper">
  
  <!-- HEADER QUE SE REPITE EN CADA PÁGINA -->
  <thead>
    <tr>
      <td>
        <header class="header">
          <div class="header-inner">
            <!-- Logo -->
            <div class="header-logo">
              ${data.logoUrl ? `<img src="${data.logoUrl}" alt="Logo ${data.tenantName}" />` : '<div class="header-logo-placeholder"></div>'}
            </div>

            <!-- Empresa / Título -->
            <div class="header-center">
              <div class="header-company">${data.tenantName}</div>
              <div class="header-nit">NIT: ${data.tenantNit}</div>
              <div class="header-title">HOJA DE TRABAJO</div>
            </div>

            <!-- Caja info -->
            <div class="header-info-box">
              <div class="numero">N°: ${data.numeroHoja}</div>
              <div class="fecha">Fecha: ${data.fecha}</div>
              <span class="estado-badge ${data.estadoClass}">${data.estadoLabel}</span>
            </div>
          </div>
        </header>
      </td>
    </tr>
  </thead>

  <!-- CONTENIDO PRINCIPAL -->
  <tbody>
    <tr>
      <td>
        <main class="content">

          <!-- INFORMACIÓN DEL CLIENTE -->
          <div class="section-header">
            <div class="bar-accent"></div>
            <div class="bar-bg"><span>INFORMACIÓN DEL CLIENTE</span></div>
          </div>

          <div class="client-card">
            <div class="client-row">
              <div class="client-cell">
                <div class="client-label">Razón Social</div>
                <div class="client-value">${data.cliente.razonSocial}</div>
              </div>
              <div class="client-cell">
                <div class="client-label">NIT</div>
                <div class="client-value">${data.cliente.nit}</div>
              </div>
              <div class="client-cell">
                <div class="client-label">Ciudad</div>
                <div class="client-value">${data.cliente.ciudad}</div>
              </div>
            </div>
            <div class="client-row">
              <div class="client-cell">
                <div class="client-label">Dirección</div>
                <div class="client-value">${data.cliente.direccion}</div>
              </div>
              <div class="client-cell">
                <div class="client-label">Departamento</div>
                <div class="client-value">${data.cliente.departamento}</div>
              </div>
              <div class="client-cell">
                <div class="client-label">Teléfono</div>
                <div class="client-value">${data.cliente.telefono}</div>
              </div>
            </div>
            ${data.cliente.email ? `
            <div class="client-row">
              <div class="client-cell">
                <div class="client-label">Email</div>
                <div class="client-value">${data.cliente.email}</div>
              </div>
            </div>
            ` : ''}
          </div>

          <!-- EQUIPOS PROCESADOS -->
          <div class="section-header mt-section">
            <div class="bar-accent"></div>
            <div class="bar-bg"><span>EQUIPOS PROCESADOS (${data.totalEquipos})</span></div>
          </div>

          <table class="equipment-table">
            <thead>
              <tr>
                <th style="width:4%">#</th>
                <th style="width:6%">Reporte</th>
                <th style="width:19%">Equipo</th>
                <th style="width:10%">Marca</th>
                <th style="width:10%">Modelo</th>
                <th style="width:9%">Serie</th>
                <th style="width:8%">Inventario</th>
                <th style="width:14%">Ubicación</th>
                <th style="width:10%">Estado</th>
                <th style="width:10%">Tipo Mtto</th>
              </tr>
            </thead>
            <tbody>
              ${data.equipos.map((equipo, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${equipo.consecutivo}</td>
                <td class="equipo-name">${equipo.nombre}</td>
                <td>${equipo.marca}</td>
                <td>${equipo.modelo}</td>
                <td>${equipo.serie}</td>
                <td>${equipo.inventario}</td>
                <td>${equipo.servicio!=='' ? `${equipo.servicio} - ${equipo.ubicacion}` : equipo.ubicacion}</td>
                <td>${equipo.estadoOperativo}</td>
                <td>${equipo.tipoMtto}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- OBSERVACIONES -->
          ${data.observaciones ? `
          <div class="section-header mt-section">
            <div class="bar-accent"></div>
            <div class="bar-bg"><span>OBSERVACIONES</span></div>
          </div>
          <div class="obs-box">${data.observaciones}</div>
          ` : ''}

          <!-- FIRMAS -->
          
          ${data.tieneFirmas ? `
          <div class="section-header mt-section"
            style="margin-bottom: 8px;"
          >
            <div class="bar-accent"></div>
            <div class="bar-bg"><span>FIRMAS</span></div>
          </div>

          <div class="firmas-row">
            ${data.firmaResponsable.imagen ? `
            <div class="firma-card">
              <div class="firma-img-area">
                <img src="${data.firmaResponsable.imagen}" alt="Firma responsable" />
              </div>
              <div class="firma-line"></div>
              <div class="firma-nombre">${data.firmaResponsable.nombre}</div>
              <div class="firma-cargo">${data.firmaResponsable.cargo}</div>
            </div>
            ` : ''}

            ${data.firmaCliente.imagen ? `
            <div class="firma-card">
              <div class="firma-img-area">
                <img src="${data.firmaCliente.imagen}" alt="Firma cliente" />
              </div>
              <div class="firma-line"></div>
              <div class="firma-nombre">${data.firmaCliente.nombre}</div>
              <div class="firma-cargo">${data.firmaCliente.cargo}</div>
            </div>
            ` : ''}
          </div>
          ` : ''}

        </main>
      </td>
    </tr>
  </tbody>

</table>

</body>
</html>`;
  }

  /**
   * Prepara los datos del SheetWork para el template
   * @private
   */
  prepareData(sheetWork, tenant) {
    // Formatear fecha
    const formatDate = (date) => {
      if (!date) return 'N/A';
      try {
        return new Date(date).toLocaleDateString('es-CO', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
      } catch (e) {
        return 'N/A';
      }
    };

    // Determinar estado de la hoja de trabajo
    const tieneFirmaResponsable = !!sheetWork.firmaResponsableFile;
    const tieneFirmaCliente = !!sheetWork.firmaFile;
    const estadoLabel = tieneFirmaResponsable && tieneFirmaCliente ? 'FIRMADA' : 'PENDIENTE';
    const estadoClass = estadoLabel === 'FIRMADA' ? 'firmada' : 'pendiente';

    // Preparar datos del cliente
    const cliente = {
      razonSocial: sheetWork.clienteId?.Razonsocial || 'N/A',
      nit: sheetWork.clienteId?.Nit || 'N/A',
      ciudad: sheetWork.clienteId?.Ciudad || 'N/A',
      direccion: sheetWork.clienteId?.Direccion || 'N/A',
      departamento: sheetWork.clienteId?.Departamento || 'N/A',
      telefono: sheetWork.clienteId?.TelContacto || 'N/A',
      email: sheetWork.clienteId?.Email || '',
    };

    // Preparar equipos desde los reports
    const equipos = (sheetWork.reports || []).map((report) => {
      const equipoData = report.equipoSnapshot || report.Equipo || {};

      return {
        consecutivo: report.consecutivo || 'N/A',
        nombre: equipoData.ItemText || equipoData.nombre || 'N/A',
        marca: equipoData.Marca || 'N/A',
        modelo: equipoData.Modelo || 'N/A',
        serie: equipoData.Serie || 'N/A',
        sede: equipoData.Sede || 'N/A',
        inventario: equipoData.Inventario || 'N/A',
        ubicacion: equipoData.Ubicacion || 'N/A',
        servicio: equipoData.Servicio || 'N/A',
        estadoOperativo: report.estadoOperativo || 'N/A',
        tipoMtto: report.tipoMtto || 'N/A',
      };
    });

    // Consolidar observaciones de la hoja de trabajo y los reportes
    const observacionesConsolidadas = this.consolidateObservations(sheetWork);

    // Preparar firmas
    const firmaResponsable = {
      imagen: sheetWork.firmaResponsableFile || '',
      nombre: sheetWork.fullNameResponsable || 'N/A',
      cargo: sheetWork.cargoResponsable || 'N/A',
    };

    const firmaCliente = {
      imagen: sheetWork.firmaFile || '',
      nombre: sheetWork.personaRecibe || 'N/A',
      cargo: sheetWork.cargoRecibe || 'N/A',
    };

    const tieneFirmas = !!firmaResponsable.imagen || !!firmaCliente.imagen;

    // Preparar contacto del tenant
    const tenantContacto = [
      tenant.telefono ? `Tel: ${tenant.telefono}` : '',
      tenant.email ? `Email: ${tenant.email}` : '',
    ]
      .filter(Boolean)
      .join(' | ') || 'N/A';

    return {
      // Tenant
      tenantName: tenant.name || 'N/A',
      tenantNit: tenant.nit || 'N/A',
      logoUrl: tenant.logoUrl || '',
      tenantDireccion: tenant.direccion || 'N/A',
      tenantContacto,

      // Hoja de trabajo
      numeroHoja: sheetWork.numeroHoja || 'N/A',
      fecha: formatDate(sheetWork.createdAt),
      estadoLabel,
      estadoClass,
      observaciones: observacionesConsolidadas,

      // Cliente
      cliente,

      // Equipos
      equipos,
      totalEquipos: equipos.length,

      // Firmas
      tieneFirmas,
      firmaResponsable,
      firmaCliente,
    };
  }

  /**
   * Consolida las observaciones de la hoja de trabajo y sus reportes
   * @private
   */
  consolidateObservations(sheetWork) {
    const observaciones = [];

    // 1. Observaciones propias de la hoja de trabajo
    if (sheetWork.observaciones && sheetWork.observaciones.trim()) {
      observaciones.push(sheetWork.observaciones.trim());
    }

    // 2. Observaciones de cada reporte vinculado
    const reportesConObservaciones = [];
    
    if (Array.isArray(sheetWork.reports) && sheetWork.reports.length > 0) {
      sheetWork.reports.forEach((report) => {
        const observacionesReporte = [];
        
        // Observación general del reporte
        if (report.observacion && report.observacion.trim()) {
          observacionesReporte.push(report.observacion.trim());
        }
        
        // Observación de estado final
        if (report.observacionEstadoFinal && report.observacionEstadoFinal.trim()) {
          observacionesReporte.push(report.observacionEstadoFinal.trim());
        }

        // Si hay observaciones para este reporte, agregarlo con su consecutivo
        if (observacionesReporte.length > 0) {
          const consecutivo = report.consecutivo || 'Sin consecutivo';
          const equipoNombre = report.equipoSnapshot?.ItemText || 'Equipo';
          reportesConObservaciones.push({
            consecutivo,
            equipoNombre,
            observaciones: observacionesReporte.join(' | '),
          });
        }
      });
    }

    // 3. Formatear el texto consolidado
    if (reportesConObservaciones.length > 0) {
      // Si hay observaciones de reportes, agregarlas debajo de las generales
      if (observaciones.length > 0) {
        observaciones.push(''); // Línea en blanco
        observaciones.push('──────────────────────────────────────────────────────');
      }
      
      observaciones.push('📋 OBSERVACIONES POR REPORTE:');
      observaciones.push(''); // Línea en blanco
      
      reportesConObservaciones.forEach((item, index) => {
        observaciones.push(`• Reporte #${item.consecutivo} — ${item.equipoNombre}`);
        observaciones.push(`  ${item.observaciones}`);
        if (index < reportesConObservaciones.length - 1) {
          observaciones.push(''); // Línea en blanco entre reportes
        }
      });
    }

    // Retornar texto consolidado o mensaje por defecto
    return observaciones.length > 0 ? observaciones.join('\n') : '';
  }

  /**
   * Retorna los estilos CSS para el PDF
   * @private
   */
  getStyles() {
    return `
    /* ─────────────────────────────────────────
       VARIABLES Y RESET
    ───────────────────────────────────────── */
    :root {
      --primary:      #0056B3;
      --primary-dark: #003C82;
      --accent:       #00A8E8;
      --success:      #228B22;
      --warning:      #E6A000;
      --dark:         #212529;
      --gray:         #6C7480;
      --light-gray:   #F5F6F8;
      --white:        #FFFFFF;
      --border:       #DCDCE1;
      --font:         'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font);
      font-size: 10px;
      color: var(--dark);
      background: #fff;
      margin: 0;
      padding: 0;
    }

    /* ─────────────────────────────────────────
       PRINT / PDF
    ───────────────────────────────────────── */
    @page {
      size: A4 portrait; 
      margin: 0;
      margin-bottom: 18mm; /* espacio para el footer en cada página */
    }

    @media print {
      html, body { 
        margin: 0; 
        padding: 0 0 25mm 0; /* ← espacio para el footer en cada página impresa */
        width: 100%;
        height: 100%;
        padding-bottom: 45mm; /* espacio para el footer fijo */
      }
    

      .page-wrapper thead {
        display: table-header-group;
      }

      .page-wrapper tfoot {
        display: table-footer-group;
      }

      .page-wrapper tbody {
        display: table-row-group;
      }
      
      .footer {
        position: fixed;
        bottom: 0;
      }
    }

    /* ─────────────────────────────────────────
       TABLA ENVOLVENTE PARA REPETIR HEADER/FOOTER
    ───────────────────────────────────────── */
    table.page-wrapper {
      width: 100%;
      border-collapse: collapse;
    }

    table.page-wrapper thead {
      display: table-header-group; /* Se repite en cada página */
    }

    table.page-wrapper tbody {
      display: table-row-group;
    }

    table.page-wrapper tfoot {
      display: table-footer-group; /* Se repite en cada página */
    }

    table.page-wrapper td {
      border: none;
      padding: 0;
      vertical-align: top;
    }

    /* ─────────────────────────────────────────
       CABECERA
    ───────────────────────────────────────── */
    .header {
      position: relative;
      padding: 10mm 15mm 6mm 15mm;
      border-bottom: 3px solid var(--primary);
      margin-bottom: 4mm;
    }

    .header::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--primary);
    }

    .header::after {
      content: '';
      position: absolute;
      bottom: 0; left: 15mm; right: 15mm;
      height: 1.5px;
      background: linear-gradient(to right, var(--primary), var(--accent));
    }

    .header-inner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }

    .header-logo {
      width: 38mm;
      flex-shrink: 0;
    }
    .header-logo img {
      max-width: 100%;
      max-height: 18mm;
      object-fit: contain;
    }
    .header-logo-placeholder {
      width: 38mm;
      height: 18mm;
    }

    .header-center {
      flex: 1;
      text-align: center;
      padding: 0 8mm;
    }
    .header-company {
      font-size: 17px;
      font-weight: 700;
      color: var(--primary-dark);
      letter-spacing: 0.3px;
      line-height: 1.2;
    }
    .header-nit {
      font-size: 9px;
      color: var(--gray);
      margin-top: 2px;
    }
    .header-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--primary);
      margin-top: 4px;
      letter-spacing: 1px;
    }

    .header-info-box {
      width: 52mm;
      flex-shrink: 0;
      background: var(--light-gray);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 8px 6px;
      text-align: center;
    }
    .header-info-box .numero {
      font-size: 10px;
      font-weight: 700;
      color: var(--primary-dark);
    }
    .header-info-box .fecha {
      font-size: 8.5px;
      color: var(--dark);
      margin-top: 3px;
    }
    .estado-badge {
      display: inline-block;
      margin-top: 5px;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 8px;
      font-weight: 700;
      color: var(--white);
      letter-spacing: 0.3px;
    }
    .estado-badge.firmada  { background: var(--success); }
    .estado-badge.pendiente{ background: var(--warning); }
    .estado-badge.cerrada  { background: var(--gray); }

    /* ─────────────────────────────────────────
       CONTENIDO
    ───────────────────────────────────────── */
    .content {
      padding: 5mm 15mm 0;  /* sin padding-bottom aquí */
    }

    /* Agrega esto nuevo */
    body {
        padding-bottom: 25mm; /* espacio reservado para el footer fijo en TODAS las páginas */
    }

    /* ─────────────────────────────────────────
       ENCABEZADO DE SECCIÓN
    ───────────────────────────────────────── */
    .section-header {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      margin-top: 6px;
    }
    .section-header .bar-accent {
      width: 4px;
      height: 22px;
      background: var(--accent);
      border-radius: 2px;
      flex-shrink: 0;
    }
    .section-header .bar-bg {
      flex: 1;
      background: var(--light-gray);
      border-bottom: 1.5px solid var(--primary);
      padding: 4px 8px;
    }
    .section-header .bar-bg span {
      font-size: 10px;
      font-weight: 700;
      color: var(--primary-dark);
      letter-spacing: 0.5px;
    }

    /* ─────────────────────────────────────────
       TARJETA CLIENTE
    ───────────────────────────────────────── */
    .client-card {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 4px;
      overflow: hidden;
    }
    .client-row {
      display: flex;
    }
    .client-row + .client-row {
      border-top: 1px solid var(--border);
    }
    .client-cell {
      flex: 1;
      padding: 5px 8px 6px;
    }
    .client-cell + .client-cell {
      border-left: 1px solid var(--border);
    }
    .client-label {
      font-size: 7px;
      font-weight: 700;
      color: var(--gray);
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 2px;
    }
    .client-value {
      font-size: 9.5px;
      color: var(--dark);
      font-weight: 400;
    }

    /* ─────────────────────────────────────────
       TABLA EQUIPOS
    ───────────────────────────────────────── */
    .equipment-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5px;
      margin-bottom: 0; /* quitar el margin artificial */
    }
    .equipment-table thead tr {
      background: var(--primary);
      color: var(--white);
    }
    .equipment-table thead th {
      padding: 5px 6px;
      text-align: center;
      font-weight: 700;
      font-size: 8.5px;
      letter-spacing: 0.3px;
      border: 1px solid var(--primary-dark);
    }
    .equipment-table thead th:nth-child(2) {
      text-align: left;
    }
    .equipment-table tbody tr:nth-child(even) {
      background: var(--light-gray);
    }
    .equipment-table tbody tr:nth-child(odd) {
      background: var(--white);
    }
    .equipment-table tbody td {
      padding: 5px 6px;
      border: 1px solid var(--border);
      color: var(--dark);
      vertical-align: middle;
    }
    .equipment-table tbody td:first-child {
      text-align: center;
      font-weight: 600;
      color: var(--gray);
    }
    .equipment-table tbody td.equipo-name {
      font-weight: 500;
    }

    /* ─────────────────────────────────────────
       OBSERVACIONES
    ───────────────────────────────────────── */
    .obs-box {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px 12px;
      font-size: 8.5px;
      color: var(--dark);
      line-height: 1.7;
      min-height: 20mm;
      white-space: pre-line;
    }

    /* ─────────────────────────────────────────
       FIRMAS
    ───────────────────────────────────────── */
    .firmas-row {
      display: flex;
      gap: 8mm;
      margin-top: 2mm;
    }
    .firma-card {
      flex: 1;
      border: none;
      border-radius: 0;
      padding: 3px 5px;
      text-align: center;
      background: transparent;
      min-height: 22mm;
      max-width: 80mm;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .firma-img-area {
      flex: 1;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding-bottom: 2px;
    }
    .firma-img-area img {
      max-width: 85%;
      max-height: 12mm;
      object-fit: contain;
    }
    .firma-line {
      width: 70%;
      border-top: 1px solid var(--dark);
      margin: 2px auto 4px;
    }
    .firma-nombre {
      font-size: 8px;
      font-weight: 700;
      color: var(--dark);
    }
    .firma-cargo {
      font-size: 7px;
      color: var(--gray);
      margin-top: 1px;
    }

    /* ─────────────────────────────────────────
       UTILIDADES
    ───────────────────────────────────────── */
    .mt-section { 
      margin-top: 6mm; 
      page-break-inside: avoid;
    }
    
    .section-header {
      page-break-after: avoid;
    }
    
    .client-card, .obs-box, .firmas-row {
      page-break-inside: avoid;
    }
    `;
  }
}

export default SheetWorkPDFService;
