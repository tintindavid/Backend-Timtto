import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { HVEquipo } from '../models/hvequipo.model.js';
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

      if (!hv) {
        throw new ApiError(404, 'HVEquipo no encontrada', 'HV_NOT_FOUND', { hvId });
      }

      // 3. Generar HTML
      const html = this.generateHTML(hv);

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
  generateHTML(hv) {
    const institucion = hv.clienteId?.Razonsocial || 'N/A';
    const nit = hv.clienteId?.Nit || 'N/A';
    const direccion = hv.clienteId?.Direccion || 'N/A';
    const ciudad = hv.clienteId?.Ciudad || 'N/A';

    const equipo = hv.equipoSnapshot?.ItemText || 'N/A';
    const sede = hv.equipoSnapshot?.Sede || 'N/A';
    const servicio = hv.equipoSnapshot?.Servicio || 'N/A';
    const inventario = hv.equipoSnapshot?.Inventario || 'N/A';

    const marca = hv.equipoSnapshot?.Marca || 'N/A';
    const modelo = hv.equipoSnapshot?.Modelo || 'N/A';
    const serie = hv.equipoSnapshot?.Serie || 'N/A';

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
    const firma1Nombre = hv.UserApruebacion || 'Pendiente de Aprobación';
    const firma1Cargo = hv.CargoUserAprobacion || '';
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
  padding: 20px;
  background: #f3f4f6;
}

@page {
  size: A4 portrait;
  margin: 12mm 10mm;
}

@media print {
  body { margin: 0; padding: 0; background: white; }
  .container { box-shadow: none; }
}

.container {
  max-width: 210mm;
  margin: 0 auto;
  background: white;
  padding: 15px;
  box-shadow: 0 0 10px rgba(0,0,0,0.1);
}

.main-header {
  display: grid;
  grid-template-columns: 120px 1fr 200px;
  gap: 15px;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 3px solid #0b5ed7;
}

.logo-container { text-align: center; }
.logo {
  width: 100px;
  height: 80px;
  background: linear-gradient(135deg, #0b5ed7, #3b82f6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 9px;
  padding: 5px;
  text-align: center;
  word-wrap: break-word;
}

.title-container { text-align: center; }
.title-container h1 {
  margin: 0 0 5px 0;
  font-size: 18px;
  color: #0b5ed7;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.title-container h2 {
  margin: 0;
  font-size: 14px;
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
  padding: 3px 8px;
  font-size: 9px;
  border-bottom: 1px solid #e5e7eb;
}
.header-info td:first-child {
  background: #f1f5f9;
  font-weight: bold;
  color: #0b5ed7;
  width: 80px;
}
.header-info tr:last-child td { border-bottom: none; }

.section { margin-bottom: 10px; }
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
}

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

table.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9px;
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

.recommendations-list {
  margin: 0;
  padding-left: 20px;
}
.recommendations-list li {
  margin-bottom: 4px;
  font-size: 8px;
  line-height: 1.4;
}

.signature-section {
  margin-top: 15px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}
.signature-box { text-align: center; }
.signature-line {
  border-top: 2px solid #374151;
  margin-top: 50px;
  padding-top: 5px;
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

<div class="container">

  <!-- HEADER -->
  <div class="main-header">
    <div class="logo-container">
      <div class="logo">${institucion}</div>
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
    <div class="field" style="margin-top: 5px;">
      <span class="field-label">Dirección:</span>
      <span class="field-value">${direccion}</span>
    </div>
  </div>

  <!-- UBICACIÓN Y EQUIPO -->
  <div class="section">
    <div class="section-header">Nombre y Ubicación del Equipo</div>
    <div class="grid-4">
      <div class="field">
        <span class="field-label">Equipo:</span>
        <span class="field-value">${equipo}</span>
      </div>
      <div class="field">
        <span class="field-label">Sede:</span>
        <span class="field-value">${sede}</span>
      </div>
      <div class="field">
        <span class="field-label">Servicio:</span>
        <span class="field-value">${servicio}</span>
      </div>
      <div class="field">
        <span class="field-label">Inventario:</span>
        <span class="field-value">${inventario}</span>
      </div>
    </div>
  </div>

  <!-- FECHAS -->
  <div class="section">
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

  <!-- DATOS DEL EQUIPO -->
  <div class="section">
    <div class="section-header">Datos del Equipo</div>
    <div class="grid-4">
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
        <span class="field-label">Año Fabricación:</span>
        <span class="field-value">${hv.AnoFabricacion || 'N/A'}</span>
      </div>
    </div>
    <div class="grid-2" style="margin-top: 8px;">
      <div class="field">
        <span class="field-label">Fabricante:</span>
        <span class="field-value">${hv.Fabricante || 'N/A'}</span>
      </div>
      <div class="field">
        <span class="field-label">País de Origen:</span>
        <span class="field-value">${hv.PaisOrigen || 'N/A'}</span>
      </div>
    </div>
  </div>

  <!-- PROVEEDOR -->
  <div class="section">
    <div class="section-header">Información del Proveedor</div>
    <div class="grid-3">
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
    </div>
    <div class="field" style="margin-top: 5px;">
      <span class="field-label">Dirección:</span>
      <span class="field-value">${hv.DireccionProveedor || hv.DireccinProveedor || 'N/A'}</span>
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
    <div class="section-header">Registro Técnico</div>
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
        <div class="section-header">Clasificación Biomédica</div>
        <div class="grid-2">
          <div class="field">
            <span class="field-label">Uso del Equipo:</span>
            <span class="field-value">${this.badge(hv.UsoEquipo || 'N/A', 'warning')}</span>
          </div>
          <div class="field">
            <span class="field-label">Tipo de Equipo:</span>
            <span class="field-value">${this.badge(hv.TipoEquipo || 'N/A', 'info')}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- REGISTRO SANITARIO -->
  <div class="section">
    <div class="section-header">Registro Sanitario y Clasificación</div>
    <div class="grid-3">
      <div class="field">
        <span class="field-label">Registro INVIMA:</span>
        <span class="field-value">${hv.RegistroINVIMA || 'N/A'}</span>
      </div>
      <div class="field">
        <span class="field-label">Clasificación por Riesgo:</span>
        <span class="field-value">${this.badge(hv.ClasificacinRiesgo || 'N/A', 'warning')}</span>
      </div>
      <div class="field">
        <span class="field-label">Requiere Calibración:</span>
        <span class="field-value">${hv.RequiereCalibracion ? 'SÍ' : 'NO'}</span>
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
    <div class="grid-4">
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
      <div class="field">
        <span class="field-label">Estado HV:</span>
        <span class="field-value">${this.badge(hv.EstadoHV || 'Guardada', hv.EstadoHV === 'Aprobada' ? 'success' : 'warning')}</span>
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
      <div class="signature-line">
        <strong>${firma1Nombre}</strong>
        <small>${firma1Cargo}</small>
      </div>
    </div>
    <div class="signature-box">
      <div class="signature-line">
        <strong>${firma2Nombre}</strong>
        <small>${firma2Cargo}</small>
      </div>
    </div>
  </div>

</div>

</body>
</html>`;
  }
}

export const hvEquipoPDFService = new HVEquipoPDFService();
