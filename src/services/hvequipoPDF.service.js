import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { HVEquipo } from '../models/hvequipo.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter } from '../utils/tenant.util.js';

export class HVEquipoPDFService {
  constructor() {
    this.pdfClient = new PDFMicroserviceClient();
  }

  /**
   * Genera PDF de una Hoja de Vida de Equipo
   * @param {string} hvId - ID de la HV
   * @param {string} tenantId - ID del tenant
   */
  async generatePDF(hvId, tenantId) {
    try {
      // 1. Verificar salud del microservicio
      const healthy = await this.pdfClient.healthCheck();
      if (!healthy) {
        throw new ApiError(503, 'Microservicio PDF no disponible', 'PDF_MICROSERVICE_OFFLINE');
      }

      // 2. Obtener la HV con datos populados
      const query = applyTenantFilter({ _id: hvId, isDeleted: false }, tenantId);
      const hv = await HVEquipo.findOne(query)
        .populate('EquipoId')
        .populate('clienteId')
        .populate('userIdCreacion', 'firstName lastName email')
        .lean();

      const tenantData = await Tenant.findOne({ tenantId: hv.tenantId, isDeleted: false }).lean();

      logger.info('tenantData consultado para PDF de HV: ',{ tenantData });
      if (!hv) {
        throw new ApiError(404, 'HVEquipo no encontrada', 'HV_NOT_FOUND', { hvId });
      }

      // 3. Generar HTML
      const html = this.generateHTML(hv, tenantData);

      // 4. Generar PDF
      logger.info(`Generando PDF para HV: ${hvId}`);
      const pdfOptions = {
        format: 'A4',
        landscape: false, // Portrait/vertical
        printBackground: true,
        margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }
      };
      
      const pdfBuffer = await this.pdfClient.generatePDF(html, pdfOptions);
      logger.info(`✅ PDF generado exitosamente para HV: ${hvId}`);

      return {
        buffer: pdfBuffer,
        filename: this.generateFileName(hv)
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error generando PDF de HV:', err);
      throw new ApiError(500, 'Error generando PDF de Hoja de Vida', 'HV_PDF_GENERATION_ERROR');
    }
  }

  /**
   * Genera el nombre del archivo PDF
   */
  generateFileName(hv) {
    const institucion = hv.clienteId?.Razonsocial || 'HV';
    const equipo = hv.equipoSnapshot?.ItemText || 'Equipo';
    const fecha = new Date().toISOString().split('T')[0];
    const safe = `${institucion}_${equipo}_${fecha}`
      .replace(/[^a-zA-Z0-9-_\.]/g, '_')
      .substring(0, 100);
    return `HV_${safe}.pdf`;
  }

  /**
   * Formatea fecha a DD/MM/YYYY
   */
  formatDate(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Formatea número a moneda COP
   */
  formatCurrency(value) {
    if (!value) return 'N/A';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(value);
  }

  /**
   * Genera badge HTML
   */
  badge(text, type = 'info') {
    return `<span class="badge badge-${type}">${text}</span>`;
  }

  /**
   * Genera el HTML completo de la HV
   */
  generateHTML(hv, tenantData) {
    const institucion = hv.clienteId?.Razonsocial || 'N/A';
    const nit = hv.clienteId?.Nit || 'N/A';
    const telefono = hv.clienteId?.Telefono || 'N/A';
    const direccion = hv.clienteId?.Direccion || 'N/A';
    const ciudad = hv.clienteId?.Ciudad || 'N/A';
    const ciudadProveedor= hv.CiudadProveedor || 'N/A';

    const equipo = hv.equipoSnapshot?.ItemText || 'N/A';
    const sede = hv.equipoSnapshot?.Sede || 'N/A';
    const servicio = hv.equipoSnapshot?.Servicio || 'N/A';
    const inventario = hv.equipoSnapshot?.Inventario || 'N/A';
    const descripcion= hv.equipoSnapshot?.Descripcion || 'N/A';

    const marca = hv.equipoSnapshot?.Marca || 'N/A';
    const modelo = hv.equipoSnapshot?.Modelo || 'N/A';
    const serie = hv.equipoSnapshot?.Serie || 'N/A';
    const ubicacion= hv.equipoSnapshot?.Ubicacion || 'N/A';
    const fotoEquipo= hv.Foto|| null;

    const logo = tenantData?.logoUrl ? `<img src="${tenantData.logoUrl}" alt="Logo" class="logo">` : `<div class="logo">Logo</div>`;

    const userCreacion = hv.userIdCreacion 
      ? `${hv.userIdCreacion.firstName} ${hv.userIdCreacion.lastName}`
      : 'N/A';

    const version = String(hv._id).substring(0, 8).toUpperCase();
    const fechaDoc = this.formatDate(hv.createdAt);
    const codigoInterno = String(hv._id).substring(0, 12).toUpperCase();

    // Accesorios
    const accesoriosHTML = (hv.Accesorios || []).map((acc, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${acc.nombre || 'N/A'}</td>
        <td>${acc.descripcion || '-'}</td>
        <td>${acc.cantidad || 0}</td>
        <td>${this.badge(acc.estado || 'N/A', 'info')}</td>
        <td>${acc.observaciones || '-'}</td>
      </tr>
    `).join('');

    const accesoriosTable = accesoriosHTML || '<tr><td colspan="6" style="text-align:center;">No hay accesorios registrados</td></tr>';

    // Recomendaciones
    const recomendacionesHTML = (hv.Recomendaciones || []).map(rec => `<li>${rec}</li>`).join('');
    const recomendacionesList = recomendacionesHTML || '<li>No hay recomendaciones específicas registradas.</li>';

    // Firmas
 
    const firmaFile1 = hv.FirmAprobacion ? `<img src="${hv.FirmAprobacion}" alt="Firma Aprobación" style="max-width: 150px; max-height: 80px;">` : 'Pendiente de Aprobación';
    const firma1Nombre = hv.UserAprobacion || 'Pendiente de Aprobación';
    const firma1Cargo = hv.CargoUserAprobacion || '';
    // si hay firma de aprobacion y no hay firma de responsable del area, debo simular un contenedor en firmaFile2 (sino hay firma responsable) con el tamaño de la firma para que no se vea desbalanceado el diseño, y colocar un texto que diga "Pendiente de Firma Responsable del Área" dejar espacio en blanco
    const firmaFile2 = hv.FirmaResponsableCustomer ? `<img src="${hv.FirmaResponsableCustomer}" alt="Firma Responsable" style="max-width: 260px; max-height: 80px;">` : '<div style="width: 260px; height: 70px; display: flex; align-items: center; justify-content: center; border: 1px solid #ccc;"></div>';
    const firma2Nombre = hv.ResponsableCustomer || 'Responsable del Área';
    const firma2Cargo = hv.CargoResponsableCustomer || 'Firma y Sello';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hoja de Vida de Equipo Biomédico</title>
<style>
* { box-sizing: border-box; }

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10px;
  color: #1f2937;
  margin: 0;
  padding: 0;
  background: white;
}

/* Configuración de página para PDF */
    @page {
        size: A4 portrait;
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

/* ==================== TABLA ENVOLVENTE PARA REPETIR HEADER ==================== */
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

table.page-wrapper td {
  border: none;
  padding: 0;
  vertical-align: top;
}




/* Header */
.main-header {
  display: grid;
  grid-template-columns: 100px 1fr 180px;
  gap: 12px;
  align-items: center;
  padding: 15px 15mm 8px 15mm;
  border-bottom: 3px solid #0b5ed7;
  background: white;
}

.logo-container { text-align: center; }
.logo {
  max-width: 120px;
  max-height: 65px;
  height: auto;
  width: auto;
  background: linear-gradient(135deg, #c7deff, #bad4ff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 8px;
  padding: 2px;
  text-align: center;
  word-wrap: break-word;
  object-fit: contain;
}

.title-container { text-align: center; }
.title-container h1 {
  margin: 0 0 3px 0;
  font-size: 16px;
  color: #0b5ed7;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.title-container h2 {
  margin: 0;
  font-size: 13px;
  color: #374151;
  font-weight: 600;
}

.header-info {
  border: 2px solid #0b5ed7;
  border-radius: 6px;
}
.header-info table {
  width: 100%;
  border-collapse: collapse;
}
.header-info td {
  padding: 2px 6px;
  font-size: 8px;
  border-bottom: 1px solid #e5e7eb;
}
.header-info td:first-child {
  background: #f1f5f9;
  font-weight: bold;
  color: #0b5ed7;
  width: 65px;
}
.header-info tr:last-child td { border-bottom: none; }

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
  font-size: 8px;
  color: #374151;
  padding: 6px 10mm 4mm 10mm;
  border-top: 2px solid #0b5ed7;
  background: white;
}

.footer-left { text-align: left; }
.footer-center {
  text-align: center;
  font-weight: bold;
  color: #0b5ed7;
  font-size: 9px;
}
.footer-right { text-align: right; }

/* Contenedor principal */
.container {
  padding: 15px 15mm;
  background: white;
}

/* Secciones */
.section { 
  margin-bottom: 10px;
  page-break-inside: avoid;
}

.section-header {
  background: linear-gradient(90deg, #0b5ed7, #3b82f6);
  color: white;
  padding: 4px 10px;
  border-radius: 5px;
  margin-bottom: 5px;
  font-weight: bold;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  page-break-after: avoid;
}

/* Sección con foto */
.section-with-photo {
  margin-bottom: 10px;
  page-break-inside: avoid;
}

.grid-withPhoto {
  display: grid; 
  grid-template-columns: 1fr 180px; 
  gap: 12px;
}

/* Foto del equipo */
.photo-box {
  border: 2px solid #0b5ed7;
  border-radius: 8px;
  padding: 10px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.photo-box-title {
  font-size: 9px;
  font-weight: bold;
  color: #0b5ed7;
  text-align: center;
  text-transform: uppercase;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.equipment-photo {
  flex: 1;
  width: 100%;
  min-height: 140px;
  border: 2px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

.equipment-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 11px;
  text-align: center;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
  padding: 10px;
}

.photo-placeholder-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

/* Grids */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; }

.field {
  display: flex;
  gap: 5px;
  font-size: 9px;
  align-items: baseline;
}

.field-label {
  font-weight: bold;
  color: #0b5ed7;
  white-space: nowrap;
}

.field-value {
  color: #374151;
  flex: 1;
  border-bottom: 1px solid #e5e7eb;
  padding: 2px 4px;
}

/* Tabla de datos */
table.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9px;
  page-break-inside: auto;
}

table.data-table thead {
  display: table-header-group;
}

table.data-table tbody {
  display: table-row-group;
}

table.data-table tr {
  page-break-inside: avoid;
  page-break-after: auto;
}

table.data-table th,
table.data-table td {
  border: 1px solid #d1d5db;
  padding: 4px 6px;
  text-align: left;
}

table.data-table th {
  background: #f1f5f9;
  font-weight: bold;
  color: #0b5ed7;
}

/* Lista de recomendaciones */
.recommendations-list {
  margin: 0;
  padding-left: 20px;
}

.recommendations-list li {
  margin-bottom: 4px;
  font-size: 8px;
  line-height: 1.4;
  page-break-inside: avoid;
}

/* Sección de firmas */
.signature-section {
  margin-top: 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  page-break-inside: avoid;
}

.signature-box { 
  text-align: center; 
}

.signature-line {
  border-top: 2px solid #374151;
  margin-top: 4px;
  padding-top: 2px;
}

.signature-box strong {
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
}

.signature-box small {
  font-size: 8px;
  color: #6b7280;
}

/* Badges */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 8px;
  font-weight: bold;
}

.badge-success { background: #d1fae5; color: #065f46; }
.badge-warning { background: #fef3c7; color: #92400e; }
.badge-info { background: #dbeafe; color: #1e40af; }
</style>
</head>
<body>

<!-- TABLA ENVOLVENTE -->
<table class="page-wrapper">
  
  <!-- HEADER QUE SE REPITE -->
  <thead>
    <tr>
      <td>
        <div class="main-header">
          <div class="logo-container">
            ${logo}
          </div>
          
          <div class="title-container">
            <h1>Hoja de Vida de Equipo</h1>
            <h2>Biomédico</h2>
          </div>
          
          <div class="header-info">
            <table>
              <tr>
                <td>Realizó:</td>
                <td>${userCreacion}</td>
              </tr>
              <tr>
                <td>Versión:</td>
                <td>${version}</td>
              </tr>
              <tr>
                <td>Fecha:</td>
                <td>${fechaDoc}</td>
              </tr>
              <tr>
                <td>Código:</td>
                <td>${codigoInterno}</td>
              </tr>
            </table>
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
          
          <!-- IDENTIFICACIÓN Y FOTO -->
          <div class="section-with-photo">
            <div class="grid-withPhoto">
              <div>
                <!-- IDENTIFICACIÓN -->
                <div class="section">
                  <div class="section-header">Identificación de la Institución</div>
                  <div class="grid-3">
                    <div class="field">
                      <span class="field-label">Institución:</span>
                      <span class="field-value">${institucion}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">NIT:</span>
                      <span class="field-value">${nit}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Ciudad:</span>
                      <span class="field-value">${ciudad}</span>
                    </div>
                  </div>
                  
                  <div class="grid-3">
                    <div class="field">
                      <span class="field-label">Dirección:</span>
                      <span class="field-value">${direccion}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Sede:</span>
                      <span class="field-value">${sede}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Teléfono:</span>
                      <span class="field-value">${telefono}</span>
                    </div>
                  </div>
                </div>
                
                <!-- DATOS DEL EQUIPO -->
                <div class="section">
                  <div class="section-header">Datos del Equipo</div>
                  <div class="grid-4">
                    <div class="field">
                      <span class="field-label">Equipo:</span>
                      <span class="field-value">${equipo}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Marca:</span>
                      <span class="field-value">${marca}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Modelo:</span>
                      <span class="field-value">${modelo}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">No. Serie:</span>
                      <span class="field-value">${serie}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Inventario:</span>
                      <span class="field-value">${inventario}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Servicio:</span>
                      <span class="field-value">${servicio}</span>
                    </div>
                    <div class="field">
                      <span class="field-label">Ubicación:</span>
                      <span class="field-value">${ubicacion}</span>
                    </div>
                  </div>
                </div>

                <!-- DESCRIPCIÓN -->
                <div class="section">
                  <div class="section-header">Descripción y Detalles</div>
                  <div class="field">
                    <span class="field-label">Descripción del equipo:</span>
                    <span class="field-value">${hv.Descripcion || 'N/A'}</span>
                  </div>
                </div>
              </div>
              
              <!-- Foto del equipo -->
              <div class="photo-box">
                <div class="photo-box-title">Foto del Equipo</div>
                <div class="equipment-photo">
                  <img src="${fotoEquipo}" alt="Foto del equipo" onerror="this.style.display='none'; this.parentElement.querySelector('.photo-placeholder').style.display='flex';">
                  <div class="photo-placeholder" style="display: none;">
                    <div class="photo-placeholder-icon">📷</div>
                    <div>Foto del<br>Equipo</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- FECHAS -->
          <div class="section">
            <div class="section-header">Fechas Importantes</div>
            <div class="grid-3">
              <div class="field">
                <span class="field-label">Fecha Adquisición:</span>
                <span class="field-value">${this.formatDate(hv.FechaAdquisicin)}</span>
              </div>
              <div class="field">
                <span class="field-label">Fecha Instalación:</span>
                <span class="field-value">${this.formatDate(hv.FechaInstalacion)}</span>
              </div>
              <div class="field">
                <span class="field-label">Puesta en Funcionamiento:</span>
                <span class="field-value">${this.formatDate(hv.FechaPuestaFuncionamiento || hv.FechaFuncionamiento)}</span>
              </div>
            </div>
          </div>

          <!-- PROVEEDOR -->
          <div class="section">
            <div class="section-header">Información del Proveedor y fabricante</div>
            <div class="grid-4">
              <div class="field">
                <span class="field-label">Proveedor:</span>
                <span class="field-value">${hv.NombreProveedor || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Teléfono:</span>
                <span class="field-value">${hv.TelefonoProveedor || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Email:</span>
                <span class="field-value">${hv.EmailProveedor || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Ciudad:</span>
                <span class="field-value">${hv.CiudadProveedor || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Dirección:</span>
                <span class="field-value">${hv.DireccionProveedor  || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Fabricante:</span>
                <span class="field-value">${hv.Fabricante || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Año Fabricación:</span>
                <span class="field-value">${hv.AnoFabricacion || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">País de Origen:</span>
                <span class="field-value">${hv.PaisOrigen || 'N/A'}</span>
              </div>
            </div>
          </div>

          <!-- GARANTÍA Y ADQUISICIÓN -->
          <div class="section">
            <div class="grid-2">
              <div>
                <div class="section-header">Garantía</div>
                <div class="grid-2">
                  <div class="field">
                    <span class="field-label">Inicio:</span>
                    <span class="field-value">${this.formatDate(hv.FechaInicioGarantia)}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Fin:</span>
                    <span class="field-value">${this.formatDate(hv.FechaFinGarantia)}</span>
                  </div>
                </div>
              </div>
              <div>
                <div class="section-header">Adquisición</div>
                <div class="grid-2">
                  <div class="field">
                    <span class="field-label">Tipo:</span>
                    <span class="field-value">${hv.TipoAdquisicion || 'N/A'}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Valor:</span>
                    <span class="field-value">${this.formatCurrency(hv.ValorAdquisicion)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- REGISTRO TÉCNICO -->
          <div class="section">
            <div class="section-header">Datos Técnico y condiciones de operación</div>
            <div class="grid-4">
              <div class="field">
                <span class="field-label">Voltaje (V):</span>
                <span class="field-value">${hv.Voltaje || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Corriente (A):</span>
                <span class="field-value">${hv.Corriente || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Frecuencia (Hz):</span>
                <span class="field-value">${hv.Frecuencia || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Potencia (W):</span>
                <span class="field-value">${hv.Potencia || 'N/A'}</span>
              </div>
            </div>
            <div class="grid-4" style="margin-top: 8px;">
              <div class="field">
                <span class="field-label">Peso (kg):</span>
                <span class="field-value">${hv.Peso || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Temperatura (°C):</span>
                <span class="field-value">${hv.TemperaturaOperacion || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Humedad (%):</span>
                <span class="field-value">${hv.HumedadOperacion || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Presión:</span>
                <span class="field-value">${hv.PresionOperacion || 'N/A'}</span>
              </div>
            </div>
          </div>

          <!-- CARACTERÍSTICAS Y CLASIFICACIÓN -->
          <div class="section">
            <div class="grid-2">
              <div>
                <div class="section-header">Características</div>
                <div class="grid-2">
                  <div class="field">
                    <span class="field-label">Fuente Alimentación:</span>
                    <span class="field-value">${hv.FuenteAlimentacion || 'N/A'}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Autonomía Batería:</span>
                    <span class="field-value">${hv.AutonomiaBatería || 'N/A'}</span>
                  </div>
                </div>
                <div class="field" style="margin-top: 5px;">
                  <span class="field-label">Tecnología:</span>
                  <span class="field-value">${hv.TecnologiaPredominante || 'N/A'}</span>
                </div>
              </div>
              <div>
                <div class="section-header">Registro sanitario y Clasificación</div>
                <div class="grid-2">
                  <div class="field">
                    <span class="field-label">Uso del Equipo:</span>
                    <span class="field-value">${this.badge(hv.UsoEquipo || 'N/A', 'warning')}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Tipo de Equipo:</span>
                    <span class="field-value">${this.badge(hv.TipoEquipo || 'N/A', 'info')}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Reg. INVIMA:</span>
                    <span class="field-value">${hv.RegistroINVIMA || 'N/A'}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Riesgo:</span>
                    <span class="field-value">${this.badge(hv.ClasificacinRiesgo || 'N/A', 'warning')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ACCESORIOS -->
          <div class="section">
            <div class="section-header">Accesorios</div>
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 5%;">No.</th>
                  <th style="width: 25%;">Nombre</th>
                  <th style="width: 30%;">Descripción</th>
                  <th style="width: 10%;">Cantidad</th>
                  <th style="width: 15%;">Estado</th>
                  <th style="width: 15%;">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                ${accesoriosTable}
              </tbody>
            </table>
          </div>

          <!-- METROLOGÍA -->
          <div class="section">
            <div class="section-header">Metrología y Mantenimiento</div>
            <div class="grid-3">
              <div class="field">
                <span class="field-label">Requiere Calibración:</span>
                <span class="field-value">${hv.RequiereCalibracion ? 'SÍ' : 'NO'}</span>
              </div>
              <div class="field">
                <span class="field-label">Periodicidad Calibración:</span>
                <span class="field-value">${hv.PeriodicidadCalibracion || 'N/A'}</span>
              </div>
              <div class="field">
                <span class="field-label">Mantenimiento Preventivo:</span>
                <span class="field-value">${hv.PeriodicidadMantenimiento || 'N/A'}</span>
              </div>
            </div>
          </div>

          <!-- RECOMENDACIONES -->
          <div class="section">
            <div class="section-header">Recomendaciones de Uso y Mantenimiento</div>
            <ol class="recommendations-list">
              ${recomendacionesList}
            </ol>
          </div>

          <!-- FIRMAS -->
          <div class="signature-section">
            <div class="signature-box">
              ${firmaFile1}
              <div class="signature-line">
                <strong>${firma1Nombre}</strong>
                <small>${firma1Cargo}</small>
              </div>
            </div>
            <div class="signature-box">
              ${firmaFile2}
              <div class="signature-line">
                <strong>${firma2Nombre}</strong>
                <small>${firma2Cargo}</small>
              </div>
            </div>
          </div>

        </div>
      </td>
    </tr>

    
  </tbody>

    <!-- FOOTER QUE SE REPITE -->
  <tfoot>
      <tr>
          <td>
            <div class="footer-content">
              <div class="footer-left">
                 ${tenantData.name}· ${tenantData.direccion}
              </div>
              <div class="footer-center">
                 ${tenantData.ciudad} - ${tenantData.departamento} 
              </div>
              <div class="footer-right">
                ${tenantData.telefono}· ${tenantData.email}
              </div>
            </div>
          </td>
        </tr>
  </tfoot>
</table>

</body>
</html>`;
  }
}

export const hvEquipoPDFService = new HVEquipoPDFService();
