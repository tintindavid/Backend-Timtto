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

/**
 * Servicio para generar PDF de Cronogramas de Mantenimiento
 */
class CronogramaPDFService {
  constructor() {
    this.pdfClient = new PDFMicroserviceClient();
  }

  /**
   * Genera PDF del cronograma
   * @param {Object} data - Datos del cronograma (cliente, grupos, filtros)
   * @returns {Promise<Buffer>} - Buffer del PDF generado
   */
  async generatePDF(data, tenant, user) {
    try {
      logger.info('Iniciando generación de PDF de Cronograma');
      logger.info('user recibido en generatePDF:', { user });
      // 1. Verificar salud del microservicio
      const healthy = await this.pdfClient.healthCheck();
      if (!healthy) {
        throw new ApiError(503, 'Microservicio PDF no disponible', 'PDF_MICROSERVICE_OFFLINE');
      }

      // 2. Validar datos requeridos
      if (!data.cliente || !data.grupos || !Array.isArray(data.grupos)) {
        throw new ApiError(400, 'Datos incompletos para generar cronograma', 'INVALID_DATA');
      }

      // 3. Generar HTML del cronograma
      const html = this.generateHTML(data, tenant, user);

      // 4. Configurar opciones del PDF
      const pdfOptions = {
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      };

      logger.info('Generando PDF de Cronograma con PDFMicroserviceClient');

      // 5. Generar PDF usando el cliente
      const pdfBuffer = await this.pdfClient.generatePDF(html, pdfOptions);

      logger.info('PDF de Cronograma generado exitosamente');
      return pdfBuffer;
    } catch (error) {
      logger.error('Error generando PDF de Cronograma:', { 
        error: error.message,
        stack: error.stack,
      });
      
      if (error instanceof ApiError) throw error;
      
      throw new ApiError(
        500,
        'Error al generar PDF del cronograma',
        'PDF_GENERATION_ERROR',
        { originalError: error.message }
      );
    }
  }

  /**
   * Genera el HTML del cronograma
   * @param {Object} data - Datos del cronograma
   * @returns {string} - HTML generado
   */
  generateHTML(data, tenant, user) {
    const { cliente, grupos, filtros = {} } = data;
    
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const añoActual = new Date().getFullYear();
    const fechaActual = new Date().toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Formatear datos del cliente
    const institucion = toTitleCase(cliente.Razonsocial);
    const nit = formatId(cliente.Nit);
    const direccion = toTitleCase(cliente.Direccion);
    const ciudad = toTitleCase(cliente.Ciudad);
    const departamento = toTitleCase(cliente.Departamento);
    const email = formatEmail(cliente.Email);
    const telefono = formatPhone(cliente.TelContacto);
    const contacto = toTitleCase(cliente.UserContacto);


    const firmaFileResponsable = user.fileFirma || '';
    const responsableFullName = `${user.firstName} ${user.lastName || ''}`.trim();

    // Construir filtros aplicados
    let filtrosTexto = '';
    if (filtros.servicioIds?.length > 0) {
      filtrosTexto += `<p><strong>Servicios:</strong> ${filtros.servicioIds.map(s => toTitleCase(s)).join(', ')}</p>`;
    }
    if (filtros.meses?.length > 0) {
      filtrosTexto += `<p><strong>Meses:</strong> ${filtros.meses.join(', ')}</p>`;
    }
    if (filtros.ubicaciones?.length > 0) {
      filtrosTexto += `<p><strong>Ubicaciones:</strong> ${filtros.ubicaciones.map(u => toTitleCase(u)).join(', ')}</p>`;
    }

    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cronograma de Mantenimiento - ${tenant.name}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Arial', sans-serif;
            font-size: 9px;
            color: #333;
            background: #fff;
            margin: 0;
            padding: 0;
        }

        /* Configuración de página para PDF */
        @page {
            size: A4 landscape;
            margin: 6mm 8mm;
        }

        @media print {
            body { 
                margin: 0; 
                padding: 0; 
                height: 100%;
            }
            
            .page-wrapper thead {
                display: table-header-group;
            }

            .page-wrapper tfoot {
                display: table-footer-group;
            }

            .page-wrapper tbody {
                display: table-row-group;
                height: 100%;
            }
        }

        /*Que aparezca el año centrado*/
        .year-header{
            text-align: center;
            font-weight: bold;
            color: #0066cc;
            font-size: 8px;
            background: #e9ecef;
            border: 1px solid #dee2e6;
            padding: 4px 3px;
        }
        /* ==================== TABLA ENVOLVENTE PARA REPETIR HEADER/FOOTER ==================== */
        table.page-wrapper {
            width: 100%;
            height: 100%;
            min-height: 100%;
            border-collapse: collapse;
        }

        table.page-wrapper thead {
            display: table-header-group; /* Se repite en cada página */
        }

        table.page-wrapper tbody {
            display: table-row-group;
            height: 100%;
        }

        table.page-wrapper tfoot {
            display: table-footer-group; /* Se repite en cada página */
        }

        table.page-wrapper td {
            border: none;
            padding: 0;
            vertical-align: top;
        }

        /* Header */
        .main-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15mm 8px 15mm;
            border-bottom: 3px solid #0066cc;
            background: white;
            margin-bottom: 6px;
        }

        .header-logo {
            max-width: 100px;
            max-height: 50px;
        }

        .header-info {
            text-align: center;
            flex: 1;
            margin: 0 15px;
        }

        .header-info h1 {
            margin: 0 0 3px 0;
            font-size: 14px;
            color: #0066cc;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .header-info p {
            margin: 2px 0;
            font-size: 8px;
        }

        .header-meta {
            text-align: right;
            font-size: 7px;
            color: #666;
        }

        .header-meta p {
            margin: 2px 0;
        }

        /* Footer */
        .footer-content {
            position: fixed;
            bottom: 6mm;
            left: 8mm;
            right: 8mm;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 10px;
            align-items: center;
            font-size: 7px;
            color: #374151;
            padding: 6px 15mm 4px 15mm;
            border-top: 2px solid #0066cc;
            background: white;
        }

        .footer-left { text-align: left; }
        .footer-center {
            text-align: center;
            font-weight: bold;
            color: #0066cc;
            font-size: 8px;
        }
        .footer-right { text-align: right; }

        /* Contenedor principal */
        .container {
            padding: 12px 15mm;
            background: white;
        }

        /* Secciones */
        .section { 
            margin-bottom: 8px;
            page-break-inside: avoid;
        }

        .cliente-info {
            background: #f5f5f5;
            padding: 8px;
            margin-bottom: 12px;
            border-radius: 4px;
            border-left: 4px solid #0066cc;
        }

        .cliente-info h2 {
            font-size: 10px;
            color: #0066cc;
            margin-bottom: 5px;
        }

        .cliente-info-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
        }

        .cliente-info-item {
            font-size: 7px;
            display: flex;
            gap: 3px;
            align-items: baseline;
        }

        .cliente-info-item strong {
            color: #666;
            white-space: nowrap;
        }

        .cliente-info-item span {
            color: #333;
        }

        .filtros-info {
            background: #fff3cd;
            padding: 6px;
            margin-bottom: 10px;
            border-radius: 4px;
            font-size: 7px;
        }

        .filtros-info h3 {
            font-size: 9px;
            margin-bottom: 4px;
            color: #856404;
        }

        .filtros-info p {
            margin: 2px 0;
        }

        .grupo-section {
            margin-bottom: 15px;
            page-break-inside: auto;
        }

        .grupo-header {
            background: #0066cc;
            color: white;
            padding: 6px 10px;
            margin-bottom: 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: bold;
            page-break-after: avoid;
        }

        /* Tabla de cronograma */
        .tabla-cronograma {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 7px;
            page-break-inside: auto;
        }

        .tabla-cronograma thead {
            margin-bottom: 4px;
            display: table-header-group;
        }

        .tabla-cronograma tbody {
            display: table-row-group;

        }

        .tabla-cronograma tr {
            margin-bottom: 4px;
            page-break-inside: avoid;
            page-break-after: auto;
        }

        .tabla-cronograma th,
        .tabla-cronograma td {
            border: 1px solid #dee2e6;
            padding: 4px 3px;
            text-align: left;
        }

        .tabla-cronograma th {
            background: #e9ecef;
            font-weight: bold;
            color: #0066cc;
            font-size: 7px;
        }

        .tabla-cronograma tbody tr:hover {
            background: #f8f9fa;
        }

        .mes-header {
            text-align: center;
            min-width: 25px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .mes-cell {
            text-align: center;
            min-width: 25px;
        }

        .mantenimiento-programado {
            background: #28a745;
            color: white;
            border-radius: 3px;
            padding: 2px 4px;
            display: inline-block;
            font-weight: bold;
        }

        .col-inventario { width: 7%; }
        .col-equipo { width: 13%; }
        .col-marca { width: 9%; }
        .col-modelo { width: 9%; }
        .col-serie { width: 9%; }
        .col-ubicacion { width: 11%; }
        .col-mes { width: 2.5%; }

        /* SECCIÓN DE FIRMAS */
        .signature-section {
            margin-top: 25px;
            padding-top: 15px;
            border-top: 2px solid #0066cc;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            page-break-inside: avoid;
        }

        .signature-box { 
            text-align: center;
        }

        .signature-placeholder {
            width: 200px;
            height: 60px;
            margin: 0 auto 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: #f8f9fa;
            color: #6c757d;
            font-size: 7px;
        }

        .signature-line {
            border-top: 2px solid #374151;
            margin-top: 10px;
            padding-top: 5px;
        }

        .signature-box strong {
            display: block;
            margin-bottom: 3px;
            font-size: 9px;
            color: #0066cc;
        }

        .signature-box small {
            font-size: 7px;
            color: #6b7280;
            display: block;
        }

        .no-equipos {
            text-align: center;
            padding: 15px;
            color: #666;
            font-style: italic;
            font-size: 8px;
        }

        .footer-note {
            position: fixed;
            bottom: 2mm;
            left: 8mm;
            right: 8mm;
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px solid #dee2e6;
            font-size: 6px;
            color: #6c757d;
            text-align: center;
        }

        @media print {
            body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }
            
            .grupo-section {
                page-break-inside: auto;
            }

            .signature-section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>

<!-- TABLA ENVOLVENTE -->
<table class="page-wrapper">
  
  <!-- HEADER QUE SE REPITE EN CADA PÁGINA -->
  <thead>
    <tr>
      <td>
        <div class="main-header">
          ${tenant.logoUrl ? `<img src="${tenant.logoUrl}" alt="Logo" class="header-logo" onerror="this.style.display='none'">` : '<div style="width:100px;"></div>'}
          
          <div class="header-info">
            <h1>CRONOGRAMA DE MANTENIMIENTO PREVENTIVO</h1>
            <p><strong>${tenant.name}</strong> - NIT: ${tenant.nit}</p>
            <p>${tenant.slogan || ''}</p>
          </div>
          
          <div class="header-meta">
            <p><strong>Fecha:</strong> ${fechaActual}</p>
            <p><strong>Contacto:</strong> ${contacto}</p>
            <p><strong>Tel:</strong> ${telefono}</p>
          </div>
        </div>
      </td>
    </tr>
  </thead>

  <!-- CONTENIDO -->
  <tbody>
    <tr>
      <td>
        <div class="container">
          
          <!-- INFO CLIENTE -->
          <div class="cliente-info">
            <h2>Información del Cliente</h2>
            <div class="cliente-info-grid">
              <div class="cliente-info-item">
                <strong>Cliente:</strong>
                <span>${institucion}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Nit:</strong>
                <span>${nit}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Dirección:</strong>
                <span>${direccion}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Ciudad:</strong>
                <span>${ciudad}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Departamento:</strong>
                <span>${departamento}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Teléfono:</strong>
                <span>${telefono}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Email:</strong>
                <span>${email}</span>
              </div>
              <div class="cliente-info-item">
                <strong>Contacto:</strong>
                <span>${contacto}</span>
              </div>
            </div>
          </div>

          <!-- CRONOGRAMA POR GRUPOS -->
          ${grupos.map(grupo => this.generateGrupoHTML(grupo, meses, añoActual)).join('')}

          <!-- SECCIÓN DE FIRMAS -->
          <div class="signature-section">
            <div class="signature-box">
              <div class="signature-placeholder">
                ${firmaFileResponsable ? `<img src="${firmaFileResponsable}" alt="Firma" style="max-width:100%; max-height:100%;">` : 'Espacio para firma'}
              </div>
              <div class="signature-line">
                <strong>Responsable de Bioingeniería</strong>
                <small>${responsableFullName}</small>
              </div>
            </div>
            <div class="signature-box">
              <div class="signature-placeholder">
                Espacio para firma
              </div>
              <div class="signature-line">
                <strong>Responsable del Área</strong>
                <small>Nombre, Firma y Sello</small>
              </div>
            </div>
          </div>

        </div>
      </td>
    </tr>
  </tbody>

  <!-- FOOTER QUE SE REPITE EN CADA PÁGINA -->
  <tfoot>
    <tr>
      <td>
        <div class="footer-content">
          <div class="footer-left">
            ${tenant.name} · ${tenant.direccion}
          </div>
          <div class="footer-center">
            ${tenant.ciudad} - ${tenant.departamento}
          </div>
          <div class="footer-right">
            ${tenant.telefono} · ${tenant.email}
          </div>
        </div>
        <div class="footer-note">
          Este cronograma es una proyección del mantenimiento preventivo programado. 
          Las fechas pueden variar según disponibilidad y condiciones operativas.
        </div>
      </td>
    </tr>
  </tfoot>

</table>

</body>
</html>
    `;
  }

  /**
   * Genera HTML para un grupo de equipos
   * @param {Object} grupo - Datos del grupo (servicio, sede, equipos)
   * @param {Array} meses - Array de meses del año
   * @param {number} año - Año actual
   * @returns {string} - HTML del grupo
   */
  generateGrupoHTML(grupo, meses, año) {
    const { servicio, sede, equipos = [] } = grupo;

    // Formatear nombres
    const servicioFormatted = toTitleCase(servicio);
    const sedeFormatted = toTitleCase(sede);

    if (equipos.length === 0) {
      return `
        <div class="grupo-section">
            <div class="grupo-header">
                ${servicioFormatted} - ${sedeFormatted}
            </div>
            <p class="no-equipos">No hay equipos registrados en este grupo</p>
        </div>
      `;
    }

    return `
      <div class="grupo-section">
          <div class="grupo-header">
              ${servicioFormatted} - ${sedeFormatted} (${equipos.length} equipos)
          </div>
          <table class="tabla-cronograma">
              <thead>
                  <tr>
                      <th class="col-inventario" rowspan="2">Inventario</th>
                      <th class="col-equipo" rowspan="2">Equipo</th>
                      <th class="col-marca" rowspan="2">Marca</th>
                      <th class="col-modelo" rowspan="2">Modelo</th>
                      <th class="col-serie" rowspan="2">Serie</th>
                      <th class="col-ubicacion" rowspan="2">Ubicación</th>
                      <th class="col-riesgo" rowspan="2">Riesgo</th>
                      <th class="col-invima" rowspan="2">Reg. Invima</th>
                      <th colspan="12" style="text-align: center;" class="year-header">${año}</th>
                  </tr>
                  <tr>
                      ${meses.map(mes => `<th class="mes-header col-mes">${mes}</th>`).join('')}
                  </tr>
              </thead>
              <tbody>
                  ${equipos.map(equipo => this.generateEquipoRow(equipo, meses)).join('')}
              </tbody>
          </table>
      </div>
    `;
  }

  /**
   * Genera fila HTML para un equipo
   * @param {Object} equipo - Datos del equipo
   * @param {Array} meses - Array de meses del año
   * @returns {string} - HTML de la fila
   */
  generateEquipoRow(equipo, meses) {
    const nombreEquipo = toTitleCase(equipo.ItemId?.Nombre);
    const marca = toTitleCase(equipo.Marca);
    const modelo = equipo.Modelo || 'N/A'; // Modelos pueden tener formato específico
    const serie = equipo.Serie || 'N/A'; // Series pueden tener formato específico
    const inventario = equipo.Inventario || 'N/A';
    const ubicacion = toTitleCase(equipo.Ubicacion);
    const riesgo = equipo.Riesgo || 'N/A';
    const regInvima = equipo.Invima || 'N/A';
    const mesesMtto = equipo.mesesMtto || [];

    return `
      <tr >
          <td>${inventario}</td>
          <td>${nombreEquipo}</td>
          <td>${marca}</td>
          <td>${modelo}</td>
          <td>${serie}</td>
          <td>${ubicacion}</td>
          <td>${riesgo}</td>
          <td>${regInvima}</td>
          ${meses.map(mes => {
            const tieneMtto = mesesMtto.includes(mes);
            return `
              <td class="mes-cell">
                  ${tieneMtto ? '<span class="mantenimiento-programado">●</span>' : '-'}
              </td>
            `;
          }).join('')}
      </tr>
    `;
  }
}

export default new CronogramaPDFService();
