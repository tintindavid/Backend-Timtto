<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Hoja de Trabajo - {{numeroHoja}}</title>
  <style>
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
      width: 210mm;
      min-height: 297mm;
    }

    /* ─────────────────────────────────────────
       PRINT / PDF
    ───────────────────────────────────────── */
    @page {
      size: A4;
      margin: 0;
    }
    @media print {
      body { width: 210mm; }
      .page-break { page-break-before: always; }
    }

    /* ─────────────────────────────────────────
       PÁGINA
    ───────────────────────────────────────── */
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 0 0 20mm 0;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    /* ─────────────────────────────────────────
       CABECERA
    ───────────────────────────────────────── */
    .header {
      position: relative;
      padding: 10mm 15mm 6mm 15mm;
      border-bottom: 3px solid var(--primary);
    }

    /* Banda superior */
    .header::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--primary);
    }

    /* Línea accent bajo la banda */
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

    /* Logo */
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

    /* Centro */
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

    /* Caja info derecha */
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
      padding: 7mm 15mm 0;
      flex: 1;
    }

    /* ─────────────────────────────────────────
       ENCABEZADO DE SECCIÓN
    ───────────────────────────────────────── */
    .section-header {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      margin-top: 8px;
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
      padding: 8px 10px;
      font-size: 9px;
      color: var(--dark);
      line-height: 1.5;
      min-height: 20mm;
    }

    /* ─────────────────────────────────────────
       FIRMAS
    ───────────────────────────────────────── */
    .firmas-row {
      display: flex;
      gap: 10mm;
      margin-top: 2mm;
    }
    .firma-card {
      flex: 1;
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 6px 10px 8px;
      text-align: center;
      background: var(--white);
      min-height: 42mm;
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
      padding-bottom: 4px;
    }
    .firma-img-area img {
      max-width: 90%;
      max-height: 25mm;
      object-fit: contain;
    }
    .firma-line {
      width: 80%;
      border-top: 1px solid var(--border);
      margin: 4px auto 6px;
    }
    .firma-nombre {
      font-size: 9px;
      font-weight: 700;
      color: var(--dark);
    }
    .firma-cargo {
      font-size: 8px;
      color: var(--gray);
      margin-top: 1px;
    }

    /* ─────────────────────────────────────────
       PIE DE PÁGINA
    ───────────────────────────────────────── */
    .footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 3px 15mm 5mm;
      border-top: 1px solid var(--border);
    }
    .footer::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 3px;
      background: var(--primary);
    }
    .footer-inner {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .footer-contact {
      font-size: 7px;
      color: var(--gray);
      line-height: 1.6;
    }
    .footer-page {
      font-size: 7.5px;
      font-weight: 700;
      color: var(--primary);
    }

    /* ─────────────────────────────────────────
       UTILIDADES
    ───────────────────────────────────────── */
    .mt-section { margin-top: 6mm; }
  </style>
</head>
<body>

<div class="page">

  <!-- ══════════════════════════════════════
       CABECERA
  ══════════════════════════════════════ -->
  <header class="header">
    <div class="header-inner">

      <!-- Logo -->
      <div class="header-logo">
        {{#if logoUrl}}
          <img src="{{logoUrl}}" alt="Logo {{tenantName}}" />
        {{else}}
          <div class="header-logo-placeholder"></div>
        {{/if}}
      </div>

      <!-- Empresa / Título -->
      <div class="header-center">
        <div class="header-company">{{tenantName}}</div>
        <div class="header-nit">NIT: {{tenantNit}}</div>
        <div class="header-title">HOJA DE TRABAJO</div>
      </div>

      <!-- Caja info -->
      <div class="header-info-box">
        <div class="numero">N°: {{numeroHoja}}</div>
        <div class="fecha">Fecha: {{fecha}}</div>
        <span class="estado-badge {{estadoClass}}">{{estadoLabel}}</span>
      </div>

    </div>
  </header>

  <!-- ══════════════════════════════════════
       CONTENIDO PRINCIPAL
  ══════════════════════════════════════ -->
  <main class="content">

    <!-- ── INFORMACIÓN DEL CLIENTE ───────── -->
    <div class="section-header">
      <div class="bar-accent"></div>
      <div class="bar-bg"><span>INFORMACIÓN DEL CLIENTE</span></div>
    </div>

    <div class="client-card">
      <div class="client-row">
        <div class="client-cell">
          <div class="client-label">Razón Social</div>
          <div class="client-value">{{cliente.razonSocial}}</div>
        </div>
        <div class="client-cell">
          <div class="client-label">NIT</div>
          <div class="client-value">{{cliente.nit}}</div>
        </div>
        <div class="client-cell">
          <div class="client-label">Ciudad</div>
          <div class="client-value">{{cliente.ciudad}}</div>
        </div>
      </div>
      <div class="client-row">
        <div class="client-cell">
          <div class="client-label">Dirección</div>
          <div class="client-value">{{cliente.direccion}}</div>
        </div>
        <div class="client-cell">
          <div class="client-label">Departamento</div>
          <div class="client-value">{{cliente.departamento}}</div>
        </div>
        <div class="client-cell">
          <div class="client-label">Teléfono</div>
          <div class="client-value">{{cliente.telefono}}</div>
        </div>
      </div>
      {{#if cliente.email}}
      <div class="client-row">
        <div class="client-cell">
          <div class="client-label">Email</div>
          <div class="client-value">{{cliente.email}}</div>
        </div>
      </div>
      {{/if}}
    </div>

    <!-- ── EQUIPOS PROCESADOS ─────────────── -->
    <div class="section-header mt-section">
      <div class="bar-accent"></div>
      <div class="bar-bg"><span>EQUIPOS PROCESADOS ({{totalEquipos}})</span></div>
    </div>

    <table class="equipment-table">
      <thead>
        <tr>
          <th style="width:5%">#</th>
          <th style="width:25%">Equipo</th>
          <th style="width:14%">Marca</th>
          <th style="width:14%">Modelo</th>
          <th style="width:14%">Serie</th>
          <th style="width:14%">Sede</th>
          <th style="width:14%">Servicio</th>
        </tr>
      </thead>
      <tbody>
        {{#each equipos}}
        <tr>
          <td>{{incrementedIndex}}</td>
          <td class="equipo-name">{{nombre}}</td>
          <td>{{marca}}</td>
          <td>{{modelo}}</td>
          <td>{{serie}}</td>
          <td>{{sede}}</td>
          <td>{{servicio}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>

    <!-- ── OBSERVACIONES (opcional) ──────── -->
    {{#if observaciones}}
    <div class="section-header mt-section">
      <div class="bar-accent"></div>
      <div class="bar-bg"><span>OBSERVACIONES</span></div>
    </div>
    <div class="obs-box">{{observaciones}}</div>
    {{/if}}

    <!-- ── FIRMAS ─────────────────────────── -->
    {{#if tieneFirmas}}
    <div class="section-header mt-section">
      <div class="bar-accent"></div>
      <div class="bar-bg"><span>FIRMAS</span></div>
    </div>

    <div class="firmas-row">

      {{#if firmaResponsable.imagen}}
      <div class="firma-card">
        <div class="firma-img-area">
          <img src="{{firmaResponsable.imagen}}" alt="Firma responsable" />
        </div>
        <div class="firma-line"></div>
        <div class="firma-nombre">{{firmaResponsable.nombre}}</div>
        <div class="firma-cargo">{{firmaResponsable.cargo}}</div>
      </div>
      {{/if}}

      {{#if firmaCliente.imagen}}
      <div class="firma-card">
        <div class="firma-img-area">
          <img src="{{firmaCliente.imagen}}" alt="Firma cliente" />
        </div>
        <div class="firma-line"></div>
        <div class="firma-nombre">{{firmaCliente.nombre}}</div>
        <div class="firma-cargo">{{firmaCliente.cargo}}</div>
      </div>
      {{/if}}

    </div>
    {{/if}}

  </main>

  <!-- ══════════════════════════════════════
       PIE DE PÁGINA
  ══════════════════════════════════════ -->
  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-contact">
        <div>{{tenantDireccion}}</div>
        <div>{{tenantContacto}}</div>
      </div>
      <div class="footer-page">Página {{paginaActual}} de {{totalPaginas}}</div>
    </div>
  </footer>

</div>

</body>
</html>