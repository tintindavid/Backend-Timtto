<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hoja de Vida de Equipo Biomédico</title>
<style>
/* ==================== CONFIG GENERAL ==================== */
* {
  box-sizing: border-box;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10px;
  color: #1f2937;
  margin: 0;
  padding: 20px;
  background: #f3f4f6;
}

/* ==================== IMPRESIÓN ==================== */
@page {
  size: A4 landscape;
  margin: 12mm 10mm;
}

@media print {
  body {
    margin: 0;
    padding: 0;
    background: white;
  }
  
  .container {
    box-shadow: none;
  }
}

/* ==================== CONTENEDOR ==================== */
.container {
  max-width: 297mm;
  margin: 0 auto;
  background: white;
  padding: 15px;
  box-shadow: 0 0 10px rgba(0,0,0,0.1);
}

/* ==================== HEADER ==================== */
.main-header {
  display: grid;
  grid-template-columns: 120px 1fr 200px;
  gap: 15px;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 3px solid #0b5ed7;
}

.logo-container {
  text-align: center;
}

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
  font-size: 11px;
}

.title-container {
  text-align: center;
}

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

.header-info tr:last-child td {
  border-bottom: none;
}

/* ==================== SECCIONES ==================== */
.section {
  margin-bottom: 10px;
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
}

/* ==================== GRIDS ==================== */
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.grid-4 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 8px;
}

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

/* ==================== TABLAS ==================== */
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

/* ==================== RECOMENDACIONES ==================== */
.recommendations-list {
  margin: 0;
  padding-left: 20px;
}

.recommendations-list li {
  margin-bottom: 4px;
  font-size: 8px;
  line-height: 1.4;
}

/* ==================== FIRMA ==================== */
.signature-section {
  margin-top: 15px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}

.signature-box {
  text-align: center;
}

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

/* ==================== BADGE ==================== */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 8px;
  font-weight: bold;
}

.badge-success {
  background: #d1fae5;
  color: #065f46;
}

.badge-warning {
  background: #fef3c7;
  color: #92400e;
}

.badge-info {
  background: #dbeafe;
  color: #1e40af;
}
</style>
</head>
<body>

<div class="container">

  <!-- ==================== HEADER ==================== -->
  <div class="main-header">
    <div class="logo-container">
      <div class="logo">
        BIOLMEC<br>SAS
      </div>
    </div>
    
    <div class="title-container">
      <h1>Hoja de Vida de Equipo</h1>
      <h2>Biomédico</h2>
    </div>
    
    <div class="header-info">
      <table>
        <tr>
          <td>Realizó:</td>
          <td>Carlos Arteaga</td>
        </tr>
        <tr>
          <td>Versión:</td>
          <td>HV-001</td>
        </tr>
        <tr>
          <td>Fecha:</td>
          <td>15/12/2024</td>
        </tr>
        <tr>
          <td>Código:</td>
          <td>BIO-VM-001</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- ==================== IDENTIFICACIÓN ==================== -->
  <div class="section">
    <div class="section-header">Identificación de la Institución</div>
    <div class="grid-3">
      <div class="field">
        <span class="field-label">Institución:</span>
        <span class="field-value">Hospital San Rafael de Montería</span>
      </div>
      <div class="field">
        <span class="field-label">NIT:</span>
        <span class="field-value">890.123.456-7</span>
      </div>
      <div class="field">
        <span class="field-label">Código Interno:</span>
        <span class="field-value">HSR-BMD-2024-003</span>
      </div>
    </div>
  </div>

  <!-- ==================== UBICACIÓN Y EQUIPO ==================== -->
  <div class="section">
    <div class="section-header">Nombre y Ubicación del Equipo</div>
    <div class="grid-4">
      <div class="field">
        <span class="field-label">Equipo:</span>
        <span class="field-value">Ventilador Mecánico</span>
      </div>
      <div class="field">
        <span class="field-label">Área:</span>
        <span class="field-value">Unidad de Cuidados Intensivos</span>
      </div>
      <div class="field">
        <span class="field-label">Servicio:</span>
        <span class="field-value">UCI Adultos</span>
      </div>
      <div class="field">
        <span class="field-label">N° Hoja de Vida:</span>
        <span class="field-value">003</span>
      </div>
    </div>
  </div>

  <!-- ==================== FECHAS ==================== -->
  <div class="section">
    <div class="grid-3">
      <div class="field">
        <span class="field-label">Fecha Adquisición:</span>
        <span class="field-value">15/03/2024</span>
      </div>
      <div class="field">
        <span class="field-label">Fecha Instalación:</span>
        <span class="field-value">20/03/2024</span>
      </div>
      <div class="field">
        <span class="field-label">Puesta en Funcionamiento:</span>
        <span class="field-value">22/03/2024</span>
      </div>
    </div>
  </div>

  <!-- ==================== DATOS DEL EQUIPO ==================== -->
  <div class="section">
    <div class="section-header">Datos del Equipo</div>
    <div class="grid-4">
      <div class="field">
        <span class="field-label">Marca:</span>
        <span class="field-value">Mindray</span>
      </div>
      <div class="field">
        <span class="field-label">Modelo:</span>
        <span class="field-value">SV300</span>
      </div>
      <div class="field">
        <span class="field-label">No. Serie:</span>
        <span class="field-value">MR2024-SV300-12345</span>
      </div>
      <div class="field">
        <span class="field-label">Año Fabricación:</span>
        <span class="field-value">2024</span>
      </div>
    </div>
    <div class="grid-2" style="margin-top: 8px;">
      <div class="field">
        <span class="field-label">Fabricante/Representante:</span>
        <span class="field-value">Mindray Medical Colombia S.A.S.</span>
      </div>
      <div class="field">
        <span class="field-label">País de Origen:</span>
        <span class="field-value">China</span>
      </div>
    </div>
  </div>

  <!-- ==================== PROVEEDOR ==================== -->
  <div class="section">
    <div class="section-header">Información del Proveedor</div>
    <div class="grid-3">
      <div class="field">
        <span class="field-label">Proveedor:</span>
        <span class="field-value">Equipos Médicos y Hospitalarios S.A.</span>
      </div>
      <div class="field">
        <span class="field-label">Teléfono:</span>
        <span class="field-value">+57 (1) 234-5678</span>
      </div>
      <div class="field">
        <span class="field-label">Email:</span>
        <span class="field-value">ventas@equiposmedicos.com.co</span>
      </div>
    </div>
    <div class="field" style="margin-top: 5px;">
      <span class="field-label">Dirección:</span>
      <span class="field-value">Calle 100 # 15-45, Bogotá D.C., Colombia</span>
    </div>
  </div>

  <!-- ==================== GARANTÍA Y ADQUISICIÓN ==================== -->
  <div class="section">
    <div class="grid-2">
      <div>
        <div class="section-header">Garantía</div>
        <div class="grid-3">
          <div class="field">
            <span class="field-label">Inicio:</span>
            <span class="field-value">22/03/2024</span>
          </div>
          <div class="field">
            <span class="field-label">Fin:</span>
            <span class="field-value">22/03/2026</span>
          </div>
          <div class="field">
            <span class="field-label">Vigencia:</span>
            <span class="field-value"><span class="badge badge-success">24 meses</span></span>
          </div>
        </div>
      </div>
      <div>
        <div class="section-header">Adquisición</div>
        <div class="grid-2">
          <div class="field">
            <span class="field-label">Tipo:</span>
            <span class="field-value">Compra Directa</span>
          </div>
          <div class="field">
            <span class="field-label">Valor:</span>
            <span class="field-value">$125,000,000 COP</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== REGISTRO TÉCNICO ==================== -->
  <div class="section">
    <div class="section-header">Registro Técnico</div>
    <div class="grid-4">
      <div class="field">
        <span class="field-label">Voltaje (V):</span>
        <span class="field-value">110-220 VAC</span>
      </div>
      <div class="field">
        <span class="field-label">Corriente (A):</span>
        <span class="field-value">2.5 A</span>
      </div>
      <div class="field">
        <span class="field-label">Frecuencia (Hz):</span>
        <span class="field-value">50/60 Hz</span>
      </div>
      <div class="field">
        <span class="field-label">Potencia (W):</span>
        <span class="field-value">450 W</span>
      </div>
    </div>
    <div class="grid-4" style="margin-top: 8px;">
      <div class="field">
        <span class="field-label">Peso (kg):</span>
        <span class="field-value">28.5 kg</span>
      </div>
      <div class="field">
        <span class="field-label">Temperatura (°C):</span>
        <span class="field-value">10-40°C</span>
      </div>
      <div class="field">
        <span class="field-label">Humedad (%):</span>
        <span class="field-value">15-95% RH</span>
      </div>
      <div class="field">
        <span class="field-label">Presión (mmHg):</span>
        <span class="field-value">700-1060 mmHg</span>
      </div>
    </div>
  </div>

  <!-- ==================== CARACTERÍSTICAS Y CLASIFICACIÓN ==================== -->
  <div class="section">
    <div class="grid-2">
      <div>
        <div class="section-header">Características</div>
        <div class="grid-2">
          <div class="field">
            <span class="field-label">Fuente de Alimentación:</span>
            <span class="field-value">Eléctrica AC/DC + Batería</span>
          </div>
          <div class="field">
            <span class="field-label">Autonomía Batería:</span>
            <span class="field-value">4 horas</span>
          </div>
        </div>
        <div class="field" style="margin-top: 5px;">
          <span class="field-label">Tecnología Predominante:</span>
          <span class="field-value">Electrónica / Neumática</span>
        </div>
      </div>
      <div>
        <div class="section-header">Clasificación Biomédica</div>
        <div class="grid-2">
          <div class="field">
            <span class="field-label">Uso del Equipo:</span>
            <span class="field-value"><span class="badge badge-warning">APOYO / SOPORTE</span></span>
          </div>
          <div class="field">
            <span class="field-label">Tipo de Equipo:</span>
            <span class="field-value"><span class="badge badge-info">CRÍTICO</span></span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== REGISTRO SANITARIO ==================== -->
  <div class="section">
    <div class="section-header">Registro Sanitario y Clasificación</div>
    <div class="grid-3">
      <div class="field">
        <span class="field-label">Registro INVIMA:</span>
        <span class="field-value">2024DM-0012345</span>
      </div>
      <div class="field">
        <span class="field-label">Clasificación por Riesgo:</span>
        <span class="field-value"><span class="badge badge-warning">CLASE IIb</span></span>
      </div>
      <div class="field">
        <span class="field-label">Requiere Calibración:</span>
        <span class="field-value">SÍ</span>
      </div>
    </div>
  </div>

  <!-- ==================== ACCESORIOS ==================== -->
  <div class="section">
    <div class="section-header">Accesorios</div>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 5%;">No.</th>
          <th style="width: 30%;">Descripción</th>
          <th style="width: 15%;">Código</th>
          <th style="width: 10%;">Cantidad</th>
          <th style="width: 20%;">Estado</th>
          <th style="width: 20%;">Observaciones</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>Circuito respiratorio adulto reutilizable</td>
          <td>CR-ADU-001</td>
          <td>3</td>
          <td><span class="badge badge-success">Operativo</span></td>
          <td>En uso</td>
        </tr>
        <tr>
          <td>2</td>
          <td>Sensor de oxígeno (O2)</td>
          <td>SEN-O2-002</td>
          <td>2</td>
          <td><span class="badge badge-success">Operativo</span></td>
          <td>Calibrado</td>
        </tr>
        <tr>
          <td>3</td>
          <td>Cable de poder principal</td>
          <td>PWR-001</td>
          <td>1</td>
          <td><span class="badge badge-success">Operativo</span></td>
          <td>-</td>
        </tr>
        <tr>
          <td>4</td>
          <td>Manguera de aire comprimido</td>
          <td>MANG-AIR-50</td>
          <td>1</td>
          <td><span class="badge badge-success">Operativo</span></td>
          <td>5 metros</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ==================== METROLOGÍA ==================== -->
  <div class="section">
    <div class="section-header">Metrología y Mantenimiento</div>
    <div class="grid-4">
      <div class="field">
        <span class="field-label">Requiere Calibración:</span>
        <span class="field-value">SÍ</span>
      </div>
      <div class="field">
        <span class="field-label">Periodicidad:</span>
        <span class="field-value">ANUAL</span>
      </div>
      <div class="field">
        <span class="field-label">Mantenimiento Preventivo:</span>
        <span class="field-value">SEMESTRAL</span>
      </div>
      <div class="field">
        <span class="field-label">Próxima Calibración:</span>
        <span class="field-value">22/03/2025</span>
      </div>
    </div>
  </div>

  <!-- ==================== RECOMENDACIONES ==================== -->
  <div class="section">
    <div class="section-header">Recomendaciones de Uso y Mantenimiento</div>
    <ol class="recommendations-list">
      <li>Realizar limpieza y desinfección del equipo después de cada uso siguiendo el protocolo institucional y las especificaciones del fabricante.</li>
      <li>Verificar el funcionamiento del equipo antes de cada uso mediante el autotest del sistema. Reportar cualquier anomalía al servicio de mantenimiento biomédico.</li>
      <li>Mantener el equipo conectado a la red eléctrica regulada y con polo a tierra efectivo. Verificar que el voltaje de alimentación esté dentro de los rangos especificados.</li>
      <li>Verificar la presión de gases medicinales (aire y oxígeno) según especificaciones del fabricante (50 PSI ± 10%). Reportar cualquier anomalía en el suministro.</li>
      <li>Utilizar únicamente accesorios y consumibles aprobados por el fabricante. No modificar ni adaptar circuitos o sensores no autorizados.</li>
      <li>Realizar mantenimiento preventivo semestral por personal calificado según cronograma establecido. Incluir calibración de sensores y verificación de alarmas.</li>
      <li>Mantener actualizado el registro de intervenciones, mantenimientos y calibraciones en la hoja de vida del equipo.</li>
      <li>Capacitar al personal operativo sobre el uso correcto del equipo según el manual del fabricante antes de su operación.</li>
      <li>No exponer el equipo a condiciones ambientales extremas fuera de los rangos especificados por el fabricante.</li>
      <li>En caso de falla o mal funcionamiento, retirar inmediatamente el equipo de servicio y reportar al área de mantenimiento biomédico.</li>
    </ol>
  </div>

  <!-- ==================== FIRMAS ==================== -->
  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-line">
        <strong>Carlos Arteaga</strong>
        <small>Ingeniero Biomédico<br>Registro: TP-123456</small>
      </div>
    </div>
    <div class="signature-box">
      <div class="signature-line">
        <strong>Responsable del Área</strong>
        <small>Coordinador UCI<br>Firma y Sello</small>
      </div>
    </div>
  </div>

</div>

</body>
</html>