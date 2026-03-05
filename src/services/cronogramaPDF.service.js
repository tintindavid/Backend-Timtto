import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { logger } from '../config/logger.config.js';
import { ApiError } from '../utils/apiError.util.js';
import { 
  toTitleCase, 
  toSentenceCase, 
  formatId, 
  formatEmail, 
  formatPhone 
} from '../utils/text.util.js';
import axios from 'axios';

class CronogramaPDFService {
  constructor() {
    this.pdfClient = new PDFMicroserviceClient();
  }

  /**
   * Convierte una URL de imagen a base64 data URI
   * @private
   */
  async imageUrlToBase64(imageUrl) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      });
      const base64 = Buffer.from(response.data).toString('base64');
      const contentType = response.headers['content-type'] || 'image/jpeg';
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      logger.warn('No se pudo convertir imagen a base64:', { url: imageUrl, error: error.message });
      return null;
    }
  }

  async generatePDF(data, tenant, user) {
    try {
      logger.info('Data recibido:', JSON.stringify({ 
        hasCliente: !!data?.cliente, 
        hasGrupos: !!data?.grupos,
        isGruposArray: Array.isArray(data?.grupos),
        gruposLength: data?.grupos?.length || 0,
        tenant: tenant?.tenantId || tenant,
        userId: user?._id || user?.id
      }));

      const healthy = await this.pdfClient.healthCheck();
      if (!healthy) {
        throw new ApiError(503, 'Microservicio PDF no disponible', 'PDF_MICROSERVICE_OFFLINE');
      }

      if (!data.cliente || !data.grupos || !Array.isArray(data.grupos)) {
        throw new ApiError(400, 'Datos incompletos para generar cronograma', 'INVALID_DATA', {
          hasCliente: !!data.cliente,
          hasGrupos: !!data.grupos,
          isArray: Array.isArray(data.grupos)
        });
      }

      // prepareData primero — buildPdfOptions lo necesita
      const prepared   = this.prepareData(data, tenant, user);
      const html       = this.generateHTML(data, tenant, user, prepared);
      const pdfOptions = await this.buildPdfOptions(prepared, tenant);

      const pdfBuffer = await this.pdfClient.generatePDF(html, pdfOptions);
      logger.info('PDF de Cronograma generado exitosamente');
      return pdfBuffer;

    } catch (error) {
      logger.error('❌ Error generando PDF de Cronograma:', { 
        message: error.message,
        code: error.code || 'UNKNOWN',
        statusCode: error.statusCode || 500,
        stack: error.stack,
      });
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al generar PDF del cronograma', 'PDF_GENERATION_ERROR', {
        originalError: error.message
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // prepareData — extrae y formatea los datos comunes
  // ─────────────────────────────────────────────────────────────────
  prepareData(data, tenant, user) {
    const { cliente } = data;

    return {
      institucion:          toTitleCase(cliente.Razonsocial),
      nit:                  formatId(cliente.Nit),
      direccion:            toTitleCase(cliente.Direccion),
      ciudad:               toTitleCase(cliente.Ciudad),
      departamento:         toTitleCase(cliente.Departamento),
      email:                formatEmail(cliente?.Email) || '',
      telefono:             formatPhone(cliente.TelContacto),
      contacto:             toTitleCase(cliente.UserContacto),
      responsableFullName:  `${user.firstName} ${user.lastName || ''}`.trim(),
      firmaFileResponsable: user.fileFirma || '',
      fechaActual:          new Date().toLocaleDateString('es-CO', {
                              year: 'numeric', month: 'long', day: 'numeric'
                            }),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // buildPdfOptions — header y footer completamente en Puppeteer
  // IMPORTANTE: los datos se interpolan aquí desde Node (strings).
  // Puppeteer NO tiene acceso a variables JS del contexto Node.
  // Las imágenes externas deben convertirse a base64 por restricciones de seguridad.
  // ─────────────────────────────────────────────────────────────────
  async buildPdfOptions(prepared, tenant) {
    const { responsableFullName, contacto, telefono, fechaActual } = prepared;

    console.log('Construyendo opciones de PDF con tenant:', tenant);
    
    // Convertir logo URL a base64 (Puppeteer no permite URLs externas en headerTemplate)
    let logoHtml = '<div style="width:100px;"></div>';
    if (tenant.logoUrl) {
      const logoBase64 = await this.imageUrlToBase64(tenant.logoUrl);
      if (logoBase64) {
        logoHtml = `<img src="${logoBase64}" alt="Logo" style="max-width:100px; max-height:50px; object-fit:contain;">`;
      } else {
        logger.warn('No se pudo cargar el logo, usando espacio vacío');
      }
    }

    console.log('Logo HTML:', logoHtml.substring(0, 100) + '...');

    // ── HEADER (~28mm de altura) ──────────────────────────────────
    const headerTemplate = `
      <div style="
        width: 100%;
        font-family: Arial, sans-serif;
        font-size: 9px;
        box-sizing: border-box;
        border-bottom: 3px solid #0066cc;
        background: white;
        padding: 14px 8mm 6px 8mm;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <!-- Logo -->
        <div style="width:100px; flex-shrink:0;">
          ${logoHtml}
        </div>

        <!-- Título -->
        <div style="flex:1; text-align:center; margin:0 15px;">
          <div style="font-size:13px; font-weight:bold; color:#0066cc; text-transform:uppercase; letter-spacing:1px;">
            CRONOGRAMA DE MANTENIMIENTO PREVENTIVO
          </div>
          <div style="font-size:8px; margin-top:3px;">
            <strong>${tenant.name}</strong> — NIT: ${tenant.nit}
          </div>
          ${tenant.slogan ? `<div style="font-size:7px; color:#666; margin-top:2px;">${tenant.slogan}</div>` : ''}
        </div>

        <!-- Meta -->
        <div style="text-align:right; font-size:7px; color:#666; white-space:nowrap;">
          <div><strong>Fecha:</strong> ${fechaActual}</div>
          <div><strong>Contacto:</strong> ${contacto}</div>
          <div><strong>Tel:</strong> ${telefono}</div>
        </div>
      </div>`;

    // ── FOOTER (~14mm de altura) ──────────────────────────────────
    const footerTemplate = `
      <div style="
        width: 100%;
        font-family: Arial, sans-serif;
        font-size: 7px;
        color: #374151;
        padding: 3px 8mm 0mm 8mm;
        border-top: 2px solid #0066cc;
        background: white;
        box-sizing: border-box;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <div style="text-align:left;">
          ${tenant.name} · ${tenant.direccion || ''} · ${tenant.ciudad || ''}, ${tenant.departamento || ''}
        </div>
        <div style="text-align:center; font-weight:bold; color:#0066cc;">
          Generado por: ${responsableFullName}
        </div>
        <div style="text-align:right;">
          Página <span class="pageNumber"></span> de <span class="totalPages"></span>
        </div>
      </div>
      <div style="
        font-family: Arial, sans-serif;
        font-size: 6px; color:#6c757d;
        text-align:center;
        padding: 1px 8mm 0;
        background: white;
      ">
        Este cronograma es una proyección del mantenimiento preventivo programado.
        Las fechas pueden variar según disponibilidad y condiciones operativas.
      </div>`;

    return {
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: {
        top:    '20mm',   // = altura del headerTemplate
        right:  '8mm',
        bottom: '14mm',   // = altura del footerTemplate
        left:   '8mm',
      },
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // generateHTML — solo contenido, sin table.page-wrapper,
  // sin .main-header, sin .footer-content, sin .footer-note
  // ─────────────────────────────────────────────────────────────────
  generateHTML(data, tenant, user, prepared) {
    const { grupos, filtros = {} } = data;
    const {
      institucion, nit, direccion, ciudad, departamento,
      email, telefono, contacto,
      responsableFullName, firmaFileResponsable,
    } = prepared;

    const meses     = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const añoActual = new Date().getFullYear();

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Cronograma de Mantenimiento - ${tenant.name}</title>
  <style>${this.getStyles()}</style>
</head>
<body>
<div class="container">

  <!-- INFO CLIENTE -->
  <div class="cliente-info">
    <h2>Información del Cliente</h2>
    <div class="cliente-info-grid">
      <div class="cliente-info-item"><strong>Cliente:</strong>      <span>${institucion}</span></div>
      <div class="cliente-info-item"><strong>NIT:</strong>          <span>${nit}</span></div>
      <div class="cliente-info-item"><strong>Dirección:</strong>    <span>${direccion}</span></div>
      <div class="cliente-info-item"><strong>Ciudad:</strong>       <span>${ciudad}</span></div>
      <div class="cliente-info-item"><strong>Departamento:</strong> <span>${departamento}</span></div>
      <div class="cliente-info-item"><strong>Teléfono:</strong>     <span>${telefono}</span></div>
      <div class="cliente-info-item"><strong>Email:</strong>        <span>${email}</span></div>
      <div class="cliente-info-item"><strong>Contacto:</strong>     <span>${contacto}</span></div>
    </div>
  </div>

  <!-- CRONOGRAMA POR GRUPOS -->
  ${grupos.map(grupo => this.generateGrupoHTML(grupo, meses, añoActual)).join('')}

  <!-- FIRMAS -->
  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-placeholder">
        ${firmaFileResponsable
          ? `<img src="${firmaFileResponsable}" alt="Firma" style="max-width:100%; max-height:100%;">`
          : 'Espacio para firma'}
      </div>
      <div class="signature-line">
        <strong>Responsable de Bioingeniería</strong>
        <small>${responsableFullName}</small>
      </div>
    </div>
    <div class="signature-box">
      <div class="signature-placeholder">Espacio para firma</div>
      <div class="signature-line">
        <strong>Responsable del Área</strong>
        <small>Nombre, Firma y Sello</small>
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
  }

  // ─────────────────────────────────────────────────────────────────
  // getStyles — solo estilos de contenido, sin header/footer CSS
  // ─────────────────────────────────────────────────────────────────
  getStyles() {
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    @page { 
      size: A4 landscape; 
      margin: 20mm 8mm 16mm 8mm; /* top right bottom left */
    }

    html, body {
      font-family: Arial, sans-serif;
      font-size: 9px;
      color: #333;
      background: #fff;
      margin: 0;
      padding: 0;
    }

    .year-header {
      text-align: center; font-weight: bold;
      color: #0066cc; font-size: 8px;
      background: #e9ecef; border: 1px solid #dee2e6; padding: 4px 3px;
    }

    .container { 
      padding: 2mm 8mm 2mm 8mm; background: white; 
      } // el padding-top aquí es para separar del header, el padding-bottom para separar del footer

    .cliente-info {
      background: #f5f5f5; padding: 8px; 
      margin: 0 0 12px 0;
      border-radius: 4px; border-left: 4px solid #0066cc;
      page-break-inside: avoid;
    }
    .cliente-info h2 { font-size: 10px; color: #0066cc; margin-bottom: 5px; }
    .cliente-info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .cliente-info-item { font-size: 9px; display: flex; gap: 3px; align-items: baseline; }
    .cliente-info-item strong { color: #666; white-space: nowrap; }
    .cliente-info-item span   { color: #333; }

    .grupo-section    { margin-bottom: 12px; page-break-inside: auto; }
    .grupo-header {
      background: #0066cc; color: white;
      padding: 5px 10px; margin-bottom: 6px;
      border-radius: 4px; font-size: 10px; font-weight: bold;
      page-break-after: avoid;
    }

    .tabla-cronograma {
      width: 100%; border-collapse: collapse;
      font-size: 9px; page-break-inside: auto;
    }
    .tabla-cronograma thead { display: table-header-group; }
    .tabla-cronograma tbody { display: table-row-group; }
    .tabla-cronograma tr    { page-break-inside: avoid; page-break-after: auto; }
    .tabla-cronograma th, .tabla-cronograma td {
      border: 1px solid #dee2e6; padding: 4px 3px; text-align: left;
    }
    .tabla-cronograma th {
      background: #e9ecef; font-weight: bold; color: #0066cc; font-size: 7px;
    }
    .tabla-cronograma tbody tr:nth-child(even) { background: #f8f9fa; }

    .mes-header { text-align: center; min-width: 25px; font-weight: bold; text-transform: uppercase; }
    .mes-cell   { text-align: center; min-width: 25px; }
    .mantenimiento-programado {
      background: #28a745; color: white;
      border-radius: 3px; padding: 2px 4px;
      display: inline-block; font-weight: bold;
    }

    .col-inventario { width: 7%;   }
    .col-equipo     { width: 13%;  }
    .col-marca      { width: 9%;   }
    .col-modelo     { width: 9%;   }
    .col-serie      { width: 9%;   }
    .col-ubicacion  { width: 11%;  }
    .col-mes        { width: 2.5%; }

    .signature-section {
      margin-top: 20px; padding-top: 12px;
      border-top: 2px solid #0066cc;
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 40px; page-break-inside: avoid;
    }
    .signature-box { text-align: center; }
    .signature-placeholder {
      width: 200px; height: 60px; margin: 0 auto 10px;
      display: flex; align-items: center; justify-content: center;
      border: 1px solid #ccc; border-radius: 4px;
      background: #f8f9fa; color: #6c757d; font-size: 7px;
    }
    .signature-line { border-top: 2px solid #374151; margin-top: 8px; padding-top: 4px; }
    .signature-box strong { display: block; margin-bottom: 3px; font-size: 9px; color: #0066cc; }
    .signature-box small  { font-size: 7px; color: #6b7280; display: block; }

    .no-equipos { text-align: center; padding: 12px; color: #666; font-style: italic; font-size: 8px; }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .signature-section { page-break-inside: avoid; }
    }
    `;
  }

  generateGrupoHTML(grupo, meses, año) {
    const { servicio, sede, equipos = [] } = grupo;
    const servicioFormatted = toTitleCase(servicio);
    const sedeFormatted     = toTitleCase(sede);

    if (equipos.length === 0) {
      return `
        <div class="grupo-section">
          <div class="grupo-header">${servicioFormatted} - ${sedeFormatted}</div>
          <p class="no-equipos">No hay equipos registrados en este grupo</p>
        </div>`;
    }

    return `
      <div class="grupo-section">
        <div class="grupo-header">${servicioFormatted} - ${sedeFormatted} (${equipos.length} equipos)</div>
        <table class="tabla-cronograma">
          <thead>
            <tr>
              <th class="col-inventario" rowspan="2">Inventario</th>
              <th class="col-equipo"     rowspan="2">Equipo</th>
              <th class="col-marca"      rowspan="2">Marca</th>
              <th class="col-modelo"     rowspan="2">Modelo</th>
              <th class="col-serie"      rowspan="2">Serie</th>
              <th class="col-ubicacion"  rowspan="2">Ubicación</th>
              <th class="col-riesgo"     rowspan="2">Riesgo</th>
              <th class="col-invima"     rowspan="2">Reg. Invima</th>
              <th colspan="12" style="text-align:center;" class="year-header">${año}</th>
            </tr>
            <tr>
              ${meses.map(mes => `<th class="mes-header col-mes">${mes}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${equipos.map(equipo => this.generateEquipoRow(equipo, meses)).join('')}
          </tbody>
        </table>
      </div>`;
  }

  generateEquipoRow(equipo, meses) {
    const nombreEquipo = toTitleCase(equipo.ItemId?.Nombre);
    const marca        = toTitleCase(equipo.Marca);
    const modelo       = equipo.Modelo     || 'N/A';
    const serie        = equipo.Serie      || 'N/A';
    const inventario   = equipo.Inventario || 'N/A';
    const ubicacion    = toTitleCase(equipo.Ubicacion);
    const riesgo       = equipo.Riesgo     || 'N/A';
    const regInvima    = equipo.Invima     || 'N/A';
    const mesesMtto    = equipo.mesesMtto  || [];

    return `
      <tr>
        <td>${inventario}</td>
        <td>${nombreEquipo}</td>
        <td>${marca}</td>
        <td>${modelo}</td>
        <td>${serie}</td>
        <td>${ubicacion}</td>
        <td>${riesgo}</td>
        <td>${regInvima}</td>
        ${meses.map(mes => `
          <td class="mes-cell">
            ${mesesMtto.includes(mes) ? '<span class="mantenimiento-programado">●</span>' : '-'}
          </td>`).join('')}
      </tr>`;
  }
}

export default new CronogramaPDFService();
