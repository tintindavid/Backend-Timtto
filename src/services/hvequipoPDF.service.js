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

      if (!hv) {
        throw new ApiError(404, 'HVEquipo no encontrada', 'HV_NOT_FOUND', { hvId });
      }

      const tenantData = await Tenant.findOne({ tenantId: hv.tenantId, isDeleted: false }).lean();
      logger.info('tenantData consultado para PDF de HV: ',{ tenantData });

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
   * Formatea fecha a DD/MM/YYYY. Returns '' for empty/invalid dates.
   */
  formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Formatea número a moneda COP. Returns '' for empty values.
   */
  formatCurrency(value) {
    if (!value) return '';
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
   * Escapes user-provided text for safe HTML interpolation.
   */
  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Only http(s) URLs may become clickable links (blocks javascript:, data:, etc.). */
  isSafeHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
  }

  /**
   * True when a value must be omitted from the PDF: null/undefined/''/'N/A',
   * empty arrays and empty plain objects.
   */
  isEmptyValue(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') {
      const t = value.trim();
      return t === '' || t.toUpperCase() === 'N/A';
    }
    if (Array.isArray(value)) return value.length === 0;
    if (value instanceof Date) return isNaN(value.getTime());
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  /**
   * Renders a label/value field, or '' when the value is empty.
   * @param {string} label
   * @param {*} value
   * @param {{formatter?: Function, badge?: string}} [opts] - badge: badge type (info|warning|success)
   */
  renderField(label, value, { formatter, badge } = {}) {
    if (this.isEmptyValue(value)) return '';
    const formatted = formatter ? formatter(value) : value;
    if (this.isEmptyValue(formatted)) return '';
    const safe = this.escapeHtml(formatted);
    const html = badge ? this.badge(safe, badge) : safe;
    return `<div class="field">
                      <span class="field-label">${label}:</span>
                      <span class="field-value">${html}</span>
                    </div>`;
  }

  /**
   * Wraps content in a section, or '' when the content is blank.
   * A falsy title renders the wrapper without header.
   */
  renderSection(title, innerHtml) {
    if (!innerHtml || String(innerHtml).trim() === '') return '';
    const header = title ? `<div class="section-header">${title}</div>` : '';
    return `<div class="section">
            ${header}
            ${innerHtml}
          </div>`;
  }

  /**
   * Wraps fields in a CSS grid, or '' when there are no fields.
   */
  renderGrid(cols, fields) {
    const inner = fields.filter(Boolean).join('\n');
    if (inner.trim() === '') return '';
    return `<div class="grid-${cols}">${inner}</div>`;
  }

  /**
   * Sub-block with its own header (used inside two-column sections).
   */
  renderSubsection(title, innerHtml) {
    if (!innerHtml || String(innerHtml).trim() === '') return '';
    return `<div><div class="section-header">${title}</div>${innerHtml}</div>`;
  }

  /**
   * Places up to two sub-blocks side by side; collapses when empty.
   */
  renderPair(left, right) {
    const parts = [left, right].filter((x) => x && x.trim() !== '');
    if (parts.length === 0) return '';
    if (parts.length === 1) return this.renderSection(null, parts[0]);
    return this.renderSection(null, `<div class="grid-2">${parts.join('\n')}</div>`);
  }

  /**
   * Genera el HTML completo de la HV
   */
  generateHTML(hv, tenantData) {
    const f = (label, value, opts) => this.renderField(label, value, opts);
    // Legacy HVs may hold free text ("Anual"); only purely numeric values get the unit.
    const formatMonths = (v) => (/^\d+$/.test(String(v).trim()) ? `${String(v).trim()} ${String(v).trim() === '1' ? 'mes' : 'meses'}` : v);
    const snap = hv.equipoSnapshot || {};
    const cli = hv.clienteId || {};
    const fotoEquipo = hv.Foto || null;

    const logo = tenantData?.logoUrl ? `<img src="${tenantData.logoUrl}" alt="Logo" class="logo">` : `<div class="logo">Logo</div>`;

    const userCreacion = hv.userIdCreacion
      ? `${hv.userIdCreacion.firstName || ''} ${hv.userIdCreacion.lastName || ''}`.trim()
      : '';

    const version = String(hv._id).substring(0, 8).toUpperCase();
    const fechaDoc = this.formatDate(hv.createdAt);
    const codigoInterno = String(hv._id).substring(0, 12).toUpperCase();

    // --- Identification / equipment / description ---
    const identificacion = this.renderSection('Identificación de la Institución',
      this.renderGrid(3, [
        f('Institución', cli.Razonsocial), f('NIT', cli.Nit), f('Ciudad', cli.Ciudad),
        f('Dirección', cli.Direccion), f('Sede', snap.Sede), f('Teléfono', cli.TelContacto),
      ]));

    const datosEquipo = this.renderSection('Datos del Equipo',
      this.renderGrid(4, [
        f('Equipo', snap.ItemText), f('Marca', snap.Marca), f('Modelo', snap.Modelo),
        f('No. Serie', snap.Serie), f('Inventario', snap.Inventario), f('Servicio', snap.Servicio),
        f('Ubicación', snap.Ubicacion),
      ]));

    const descripcion = this.renderSection('Descripción y Detalles',
      f('Descripción del equipo', hv.Descripcion || snap.Descripcion));

    const leftColumn = [identificacion, datosEquipo, descripcion].join('\n');
    const photoBox = fotoEquipo ? `<div class="photo-box">
                <div class="photo-box-title">Foto del Equipo</div>
                <div class="equipment-photo">
                  <img src="${fotoEquipo}" alt="Foto del equipo" onerror="this.style.display='none'; this.parentElement.querySelector('.photo-placeholder').style.display='flex';">
                  <div class="photo-placeholder" style="display: none;">
                    <div class="photo-placeholder-icon">📷</div>
                    <div>Foto del<br>Equipo</div>
                  </div>
                </div>
              </div>` : '';
    let identificacionBlock = '';
    if (photoBox) {
      identificacionBlock = `<div class="section-with-photo">
            <div class="grid-withPhoto">
              <div>${leftColumn}</div>
              ${photoBox}
            </div>
          </div>`;
    } else if (leftColumn.trim() !== '') {
      identificacionBlock = `<div>${leftColumn}</div>`;
    }

    // --- Dates ---
    const fechas = this.renderSection('Fechas Importantes',
      this.renderGrid(3, [
        f('Fecha Adquisición', hv.FechaAdquisicin, { formatter: (v) => this.formatDate(v) }),
        f('Fecha Instalación', hv.FechaInstalacion, { formatter: (v) => this.formatDate(v) }),
        f('Puesta en Funcionamiento', hv.FechaPuestaFuncionamiento || hv.FechaFuncionamiento, { formatter: (v) => this.formatDate(v) }),
      ]));

    // --- Provider ---
    const proveedor = this.renderSection('Información del Proveedor y fabricante',
      this.renderGrid(4, [
        f('Proveedor', hv.NombreProveedor), f('Teléfono', hv.TelefonoProveedor),
        f('Email', hv.EmailProveedor), f('Ciudad', hv.CiudadProveedor),
        f('Dirección', hv.DireccionProveedor), f('Fabricante', hv.Fabricante),
        f('Año Fabricación', hv.AnoFabricacion), f('País de Origen', hv.PaisOrigen),
      ]));

    // --- Warranty & acquisition ---
    const garantiaYAdquisicion = this.renderPair(
      this.renderSubsection('Garantía', this.renderGrid(2, [
        f('Inicio', hv.FechaInicioGarantia, { formatter: (v) => this.formatDate(v) }),
        f('Fin', hv.FechaFinGarantia, { formatter: (v) => this.formatDate(v) }),
      ])),
      this.renderSubsection('Adquisición', this.renderGrid(2, [
        f('Tipo', hv.TipoAdquisicion),
        f('Valor', hv.ValorAdquisicion, { formatter: (v) => this.formatCurrency(v) }),
      ])),
    );

    // --- Technical ---
    const tecnico = this.renderSection('Datos Técnico y condiciones de operación',
      this.renderGrid(4, [
        f('Voltaje (V)', hv.Voltaje), f('Corriente (A)', hv.Corriente),
        f('Frecuencia (Hz)', hv.Frecuencia), f('Potencia (W)', hv.Potencia),
        f('Peso (kg)', hv.Peso), f('Temperatura (°C)', hv.TemperaturaOperacion),
        f('Humedad (%)', hv.HumedadOperacion), f('Presión', hv.PresionOperacion),
      ]));

    // --- Characteristics & classification ---
    const caracteristicas = this.renderPair(
      this.renderSubsection('Características', this.renderGrid(2, [
        f('Fuente Alimentación', hv.FuenteAlimentacion),
        f('Autonomía Batería', hv.AutonomiaBatería),
        f('Tecnología', hv.TecnologiaPredominante),
      ])),
      this.renderSubsection('Registro sanitario y Clasificación', this.renderGrid(2, [
        f('Uso del Equipo', hv.UsoEquipo, { badge: 'warning' }),
        f('Tipo de Equipo', hv.TipoEquipo, { badge: 'info' }),
        f('Reg. INVIMA', hv.RegistroINVIMA),
        f('Riesgo', hv.ClasificacinRiesgo, { badge: 'warning' }),
      ])),
    );

    // --- Otras especificaciones ---
    const otrasEsp = (hv.OtrasEspecificaciones || []).filter((e) => e && !this.isEmptyValue(e.nombre) && !this.isEmptyValue(e.valor));
    const otrasEspecificaciones = this.renderSection('Otras Especificaciones',
      this.renderGrid(4, otrasEsp.map((e) => f(this.escapeHtml(e.nombre), e.valor))));

    // --- Accessories ---
    const accesorios = hv.Accesorios || [];
    const accesoriosSection = this.renderSection('Accesorios', accesorios.length === 0 ? '' : `
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
                ${accesorios.map((acc, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${this.escapeHtml(acc.nombre || '')}</td>
                  <td>${this.escapeHtml(acc.descripcion || '')}</td>
                  <td>${acc.cantidad ?? ''}</td>
                  <td>${acc.estado ? this.badge(this.escapeHtml(acc.estado), 'info') : ''}</td>
                  <td>${this.escapeHtml(acc.observaciones || '')}</td>
                </tr>`).join('')}
              </tbody>
            </table>`);

    // --- Metrology & maintenance ---
    const metrologia = this.renderSection('Metrología y Mantenimiento',
      this.renderGrid(3, [
        typeof hv.RequiereCalibracion === 'boolean' ? f('Requiere Calibración', hv.RequiereCalibracion ? 'SÍ' : 'NO') : '',
        f('Periodicidad Calibración', hv.PeriodicidadCalibracion, { formatter: formatMonths }),
        f('Mantenimiento Preventivo', hv.PeriodicidadMantenimiento, { formatter: formatMonths }),
      ]));

    // --- Recommendations ---
    const recs = (Array.isArray(hv.Recomendaciones) ? hv.Recomendaciones : [hv.Recomendaciones])
      .filter((r) => !this.isEmptyValue(r));
    const recomendaciones = this.renderSection('Recomendaciones de Uso y Mantenimiento', recs.length === 0 ? '' : `
            <ol class="recommendations-list">
              ${recs.map((rec) => `<li>${this.escapeHtml(rec)}</li>`).join('')}
            </ol>`);

    // --- Documentos adjuntos ---
    const docs = (hv.Documentos || []).filter((d) => d && !this.isEmptyValue(d.nombre));
    const documentosSection = this.renderSection('Documentos Adjuntos', docs.length === 0 ? '' : `
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 30%;">Nombre</th>
                  <th style="width: 40%;">Link</th>
                  <th style="width: 30%;">Archivo</th>
                </tr>
              </thead>
              <tbody>
                ${docs.map((d) => {
                  const linkCell = this.isEmptyValue(d.link)
                    ? ''
                    : this.isSafeHttpUrl(d.link)
                      ? `<a href="${this.escapeHtml(d.link)}">${this.escapeHtml(d.link)}</a>`
                      : this.escapeHtml(d.link);
                  const hint = this.isEmptyValue(d.mimetype) ? '' : ` (${this.escapeHtml(d.mimetype)})`;
                  const fileCell = this.isEmptyValue(d.archivoUrl) || !this.isSafeHttpUrl(d.archivoUrl)
                    ? ''
                    : `<a href="${this.escapeHtml(d.archivoUrl)}">Descargar</a>${hint}`;
                  return `<tr><td>${this.escapeHtml(d.nombre)}</td><td>${linkCell}</td><td>${fileCell}</td></tr>`;
                }).join('')}
              </tbody>
            </table>`);

    // --- Signatures ---
    const firmaFile1 = hv.FirmAprobacion ? `<img src="${hv.FirmAprobacion}" alt="Firma Aprobación" style="max-width: 150px; max-height: 80px;">` : 'Pendiente de Aprobación';
    const firma1Nombre = hv.UserAprobacion || 'Pendiente de Aprobación';
    const firma1Cargo = hv.CargoUserAprobacion || '';
    // Keep the layout balanced when there is no responsible-person signature
    const firmaFile2 = hv.FirmaResponsableCustomer ? `<img src="${hv.FirmaResponsableCustomer}" alt="Firma Responsable" style="max-width: 260px; max-height: 80px;">` : '<div style="width: 260px; height: 70px; display: flex; align-items: center; justify-content: center; border: 1px solid #ccc;"></div>';
    const firma2Nombre = hv.ResponsableCustomer || 'Responsable del Área';
    const firma2Cargo = hv.CargoResponsableCustomer || 'Firma y Sello';

    const footerLeft = [tenantData?.name, tenantData?.direccion].filter(Boolean).join(' · ');
    const footerCenter = [tenantData?.ciudad, tenantData?.departamento].filter(Boolean).join(' - ');
    const footerRight = [tenantData?.telefono, tenantData?.email].filter(Boolean).join(' · ');

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
                <td>${this.escapeHtml(userCreacion)}</td>
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
          
          ${identificacionBlock}
          ${fechas}
          ${proveedor}
          ${garantiaYAdquisicion}
          ${tecnico}
          ${caracteristicas}
          ${otrasEspecificaciones}
          ${accesoriosSection}
          ${metrologia}
          ${recomendaciones}
          ${documentosSection}

          <!-- FIRMAS -->
          <div class="signature-section">
            <div class="signature-box">
              ${firmaFile1}
              <div class="signature-line">
                <strong>${this.escapeHtml(firma1Nombre)}</strong>
                <small>${firma1Cargo}</small>
              </div>
            </div>
            <div class="signature-box">
              ${firmaFile2}
              <div class="signature-line">
                <strong>${this.escapeHtml(firma2Nombre)}</strong>
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
                 ${this.escapeHtml(footerLeft)}
              </div>
              <div class="footer-center">
                 ${this.escapeHtml(footerCenter)}
              </div>
              <div class="footer-right">
                ${this.escapeHtml(footerRight)}
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
