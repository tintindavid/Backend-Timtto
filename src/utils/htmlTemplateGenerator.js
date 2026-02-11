'use strict';


function getHTMLTemplate() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Reporte de Servicio - BIOLMEC</title>
<style>
    * {
        box-sizing: border-box;
    }

    body {
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        background: #eef2f7;
        color: #1a1a1a;
    }

    /* ====== CONFIGURACIÓN DE PÁGINA PARA IMPRESIÓN ====== */
    @page {
        size: A4 portrait;
        margin: 10mm 8mm;
    }

    @media print {
        body {
            margin: 0;
            padding: 0;
            background: white;
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

        .section,
        .actividad-item,
        .info-card,
        .firma-card {
            page-break-inside: avoid;
        }
    }

    /* ====== ESTILOS PARA ACTIVIDADES ====== */
    .actividades-grid {
        display: flex;
        flex-wrap: wrap;
    }

    .actividad-item {
        width: 50%;
        box-sizing: border-box;
        padding-right: 10px;
        margin-bottom: 8px;
    }

    /* ====== TABLA ENVOLVENTE ====== */
    .page-wrapper {
        width: 100%;
        border-collapse: collapse;
    }


    .page-wrapper td {
        border: none;
        padding: 0;
        vertical-align: top;
    }

    .page {
        width: 100%;
        background: #fff;
        padding: 20px 28px;
        box-sizing: border-box;
    }

    /* ====== HEADER ====== */
    .header-wrapper {
        background:  #fff; 
        padding: 10px;
        border-radius: 10px;
        color: black;
        margin-bottom: 4px;
    }

/* Header de tabla se repite */
  thead {
    display: table-header-group;
  }
/* ==================== TABLA ENVOLVENTE PARA REPETIR HEADER ==================== */
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

table.page-wrapper td {
  border: none;
  padding: 0;
  vertical-align: top;
}

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    /* ====== ESTILOS PARA CONTENEDORES DE LOGOS ====== */
    .logo-container {
        width: 140px;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: white;
        border-radius: 8px;
        padding: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .logo-container img {
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        object-fit: contain;
        display: block;
    }

    .logo-empresa, .logo-cliente {
        width: 130px;
        height: 60px;
        object-fit: contain;
        background: white;
        border-radius: 8px;
        padding: 6px;
    }

    .header-center {
        text-align: center;
    }

    .header-center h1 {
        margin: 0;
        font-size: 24px;
        font-weight: bold;
    }

    .subtitle {
        font-size: 15px;
        margin-top: 3px;
        opacity: 0.9;
    }

    .document-title {
        font-size: 16px;
        margin-top: 4px;
        font-weight: bold;
        letter-spacing: 1px;
    }

    /* ====== INFO CARDS ====== */
    .report-info-cards {
        display: flex;
        gap: 8px;
        margin-top: 2px;
        flex-wrap: wrap;
    }

    .info-card {
        background: #ffffff;
        padding: 10px 14px;
        border-radius: 10px;
        width: 110px;
        border-left: 4px solid #0074C7;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    }

    .info-card .label {
        font-size: 10px;
        opacity: 0.7;
        text-transform: uppercase;
    }

    .info-card .value {
        margin-top: 3px;
        font-weight: bold;
        font-size: 12px;
    }

    /* ===== SECCIONES ===== */
    .section {
        margin-top: 22px;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 6px;
        border-bottom: 2px solid #0074C7;
    }

    .section-header .icon {
        font-size: 18px;
    }

    .section-header .title {
        font-size: 18px;
        font-weight: bold;
        color: #003B73;
    }

    .info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
        margin-top: 10px;
    }

    .info-item {
        display: flex;
        gap: 4px;
        font-size: 14px;
    }

    .info-item .label {
        font-weight: bold;
        color: #003B73;
    }

    .info-item .value {
        font-weight: normal;
    }

    /* ===== ACTIVIDADES ===== */
    .actividades-grid {
        margin-top: 10px;
    }

    .actividad-item {
        background: #eef5ff;
        padding: 8px;
        border-radius: 6px;
        border-left: 4px solid #0074C7;
        margin-bottom: 6px;
    }

    /* ===== TABLA DE REPUESTOS ===== */
    .repuestos-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        font-size: 14px;
    }

    .repuestos-table th {
        background: #003B73;
        color: white;
        padding: 8px;
    }

    .repuestos-table td {
        padding: 8px;
        border-bottom: 1px solid #ddd;
    }

    /* ===== FOTOS ===== */
    .fotos-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 12px;
    }

    .foto-item {
        width: 180px;
        height: 130px;
        border-radius: 10px;
        overflow: hidden;
        border: 2px solid #0074C7;
    }

    .foto-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    /* ===== OBSERVACIONES ===== */
    .observaciones-box {
        margin-top: 10px;
        background: #f3f6fa;
        padding: 12px;
        border-radius: 8px;
        border-left: 4px solid #0074C7;
    }

    .section-content {
        margin-top: 10px;
    }

    /* ====== FIRMAS ====== */
    .firmas-section {
        margin-top: 25px;
    }

    .firmas-grid {
        display: flex;
        justify-content: space-between;
        gap: 20px;
    }

    .firma-card {
        flex: 1;
        padding: 12px;
        border: 1px solid #c7d3e8;
        border-radius: 8px;
        background: #fbfcff;
        box-shadow: 0 2px 4px rgba(0,0,0,0.06);
    }

    .firma-space {
        margin-top: 8px;
        height: 60px;
        border-bottom: 2px solid #003B73;
        display: flex;
        justify-content: center;
        align-items: flex-end;
        font-size: 12px;
        color: #777;
    }

    .firma-space img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border: none;
    }

    .firma-name {
        margin-top: 10px;
        font-weight: bold;
        font-size: 14px;
    }

    .firma-cargo {
        font-size: 12px;
        opacity: 0.8;
    }

    /* ===== FOOTER ===== */
    .footer {
        padding: 15px 28px;
        text-align: center;
        font-size: 12px;
        color: #666;
        background: #f8f9fa;
        border-top: 2px solid #0074C7;
    }
</style>
</head>

<body>

<!-- TABLA ENVOLVENTE PARA REPETIR HEADER Y FOOTER -->
<table class="page-wrapper">
    
    <!-- HEADER QUE SE REPITE EN CADA PÁGINA -->
    <thead>
        <tr>
            <td>
                <div class="page">
                    <div class="header-wrapper">
                        <div class="header">
                            
                            <!-- Logo empresa -->
                            <div class="logo-container">
                                {{logoTenant}}

                            </div>

                            <!-- Center -->
                            <div class="header-center">
                                <h1>{{tenantName}}</h1>
                                <h2 class="subtitle">ESPECIALISTAS EN BIOINGENIERIA</h2>
                                <hr/>
                                <div class="subtitle">REPORTE DE SERVICIO TÉCNICO</div>
                                <div class="subtitle">VERSIÓN 4</div>
                            </div>

                            <!-- Logo cliente -->
                            <div class="logo-container">
                                {{logoCliente}}

                            </div>

                        </div>
                    </div>
                </div>
            </td>
        </tr>
    </thead>

    <!-- CONTENIDO PRINCIPAL -->
    <tbody>
        <tr>
            <td>
                <div class="page">

                    <!-- INFO CARDS -->
                    <div class="report-info-cards">
                        <div class="info-card">
                            <div class="label">Reporte</div>
                            <div class="value">{{numeroReporte}}</div>
                        </div>
                        <div class="info-card">
                            <div class="label">OT</div>
                            <div class="value">{{numeroOT}}</div>
                        </div>
                        <div class="info-card">
                            <div class="label">Fecha</div>
                            <div class="value">{{fecha}}</div>
                        </div>
                        <div class="info-card">
                            <div class="label">Tipo</div>
                            <div class="value">{{tipoServicio}}</div>
                        </div>
                        <div class="info-card">
                            <div class="label">Estado</div>
                            <div class="value">{{estado}}</div>
                        </div>
                    </div>

                    <!-- CLIENTE -->
                    <div class="section">
                        <div class="section-header">
                            <div class="title">Información del Cliente</div>
                        </div>

                        <div class="info-grid">
                            <div class="info-item">
                                <span class="label">Cliente:</span>
                                <span class="value">{{clienteNombre}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">NIT:</span>
                                <span class="value">{{clienteNit}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Ciudad:</span>
                                <span class="value">{{clienteCiudad}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Dirección:</span>
                                <span class="value">{{clienteDireccion}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Teléfono:</span>
                                <span class="value">{{clienteTelefono}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Contacto:</span>
                                <span class="value">{{clienteContacto}}</span>
                            </div>
                        </div>
                    </div>

                    <!-- EQUIPO -->
                    <div class="section">
                        <div class="section-header">
                            <div class="title">Información del Equipo</div>
                        </div>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="label">Equipo:</span>
                                <span class="value">{{equipoNombre}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Marca:</span>
                                <span class="value">{{equipoMarca}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Modelo:</span>
                                <span class="value">{{equipoModelo}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Serial:</span>
                                <span class="value">{{equipoSerial}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Inventario:</span>
                                <span class="value">{{equipoInventario}}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Servicio:</span>
                                <span class="value">{{equipoServicio}} - {{equipoUbicacion}}</span>
                            </div>
                        </div>
                    </div>

                    <!-- FALLA REPORTADA -->
                    
                    
                    <!-- DIAGNOSTICO -->
                     

                     <!-- ACCION TOMADA -->
                     {{accionTomada}}
                    

                    <!-- ACTIVIDADES -->
                    {{actividades}}

                    <!-- ACCESORIOS DEL EQUIPO -->
                    

                    <!-- MOTIVO FUERA DE SERVICIO -->
                    

                    <!-- REPUESTOS -->
                    {{repuestos}}

                    <!-- FOTOS -->
                    

                    <!-- OBSERVACIONES -->
                    <div class="section">
                        <div class="section-header">
                            <div class="title">Observaciones</div>
                        </div>
                        <div class="observaciones-box">
                            {{observaciones}}
                        </div>
                    </div>

                    <!-- FIRMAS -->
                    <div class="firmas-section">
                        <div class="firmas-grid">

                            <!-- Firma Técnico -->
                            <div class="firma-card">
                                <div class="firma-space">{{firmaResponsable}}</div>
                                <div class="firma-name"><strong>Técnico: </strong>{{tecnicoNombre}}</div>
                                <div class="firma-cargo"><strong>Cargo: </strong>{{tecnicoCargo}}</div>
                            </div>

                            <!-- Firma Cliente -->
                            <div class="firma-card">
                                <div class="firma-space">{{firmaCliente}}</div>
                                <div class="firma-name"><strong>Recibe: </strong>{{clienteFirmaNombre}}</div>
                                <div class="firma-cargo"><strong>Cargo: </strong>{{clienteFirmaCargo}}</div>
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
                <div class="footer">
{{tenantName}}· {{tenantDireccion}} {{tenantCiudad}} - {{tenantDepartamento}} · {{tenantTelefono}}· {{tenantEmail}}
                </div>
            </td>
        </tr>
    </tfoot>

</table>

</body>
</html>`;
}

function formatDate(date) {
  if (!date) return 'N/A';
  try { return new Date(date).toLocaleDateString('es-CO'); } catch (e) { return 'N/A'; }
}

function generateHTMLFromReport(report = {}, tenantData={}, template = getHTMLTemplate()) {
    
    const map = {
    tenantName:tenantData.name || 'N/A',   //en mayuscula
    tenantSlogan:tenantData.slogan || '',
    tenantDireccion:tenantData.direccion || 'N/A',
    tenantTelefono:tenantData.telefono || 'N/A',
    tenantCiudad:tenantData.ciudad || 'N/A',
    tenantDepartamento:tenantData.departamento || '',
    tenantEmail:tenantData.email || 'N/A',
    tenantLogoUrl:tenantData.logoUrl || '',
    numeroReporte: report.consecutivo ?? (report._id ? String(report._id) : 'N/A'),
    numeroOT: report.orden.Consecutivo || 'N/A',
    fecha: formatDate(report.fechaProcesado ?? report.fechaProcesado ?? report.createdAt),
    tipoServicio: report.tipoMtto ?? report.orden.TipoServicio ?? 'N/A',
    estado: report.EstadoOperativo ?? report.estadoOperativo ?? 'N/A',
    clienteNombre: report.ClienteId?.Razonsocial ?? report.ClienteNombre ?? 'N/A',
    clienteNit: report.ClienteId?.Nit ?? 'N/A',
    clienteCiudad: report.Equipo?.SedeId?.ciudad || report.ClienteId?.Ciudad || 'N/A',
    clienteDireccion: report.Equipo?.SedeId?.direccion ||  report.ClienteId?.Direccion  || 'N/A',
    clienteTelefono: report.Equipo?.SedeId?.telefono ||  report.ClienteId?.TelContacto  || 'N/A',
    clienteContacto: report.Equipo?.SedeId?.contact || report.ClienteId?.UserContacto || 'N/A',
    equipoNombre: report.equipoSnapshot?.ItemText ?? 'N/A',
    equipoMarca: report.equipoSnapshot?.Marca ?? 'N/A',
    equipoModelo: report.equipoSnapshot?.Modelo ?? 'N/A',
    equipoSerial: report.equipoSnapshot?.Serie ?? 'N/A',
    equipoInventario: report.equipoSnapshot?.Inventario ?? 'N/A',
    equipoServicio: report.equipoSnapshot?.Servicio ?? 'N/A',
    equipoUbicacion: report.equipoSnapshot?.Ubicacion ?? 'N/A',
    tecnicoNombre: report?.hojaDeTrabajo?.fullNameResponsable || 'N/A',
    tecnicoCargo: report?.hojaDeTrabajo?.cargoResponsable ?? 'Técnico' ?? 'N/A',
    clienteFirmaNombre: report?.hojaDeTrabajo?.personaRecibe ?? 'N/A',
    clienteFirmaCargo: report?.hojaDeTrabajo?.cargoRecibe ?? 'N/A',
  };

  const actividades = renderActividades(report.actividadesRealizadas);

  // repuestos
  let repuestosHtml = '';
  if (Array.isArray(report.repuestos) && report.repuestos.length) {
    repuestosHtml = `<div class="section"><div class="section-header"><div class="title">Repuestos</div></div><table class="repuestos-table"><thead><tr><th>Nombre</th><th>Cantidad</th><th>Instalación</th><th>Observación</th></tr></thead><tbody>${report.repuestos.map(r => `<tr><td>${r.nombre ?? 'N/A'}</td><td>${r.Cantidad ?? r.CantidadInstalacion ?? 'N/A'}</td><td>${r.FechaInstalacion ? formatDate(r.FechaInstalacion) : 'N/A'}</td><td>${r.observacion ?? ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  //Firma responsable
  let firmaResponsableHtml = '';
  if (report.hojaDeTrabajo?.firmaResponsableFile) {
    firmaResponsableHtml = `<img src="${report.hojaDeTrabajo.firmaResponsableFile}" alt="Firma Responsable"/>`;
  }
  //Firma cliente firmaFile
    let firmaClienteHtml = '';
    if (report.hojaDeTrabajo?.firmaFile) {
        firmaClienteHtml = `<img src="${report.hojaDeTrabajo.firmaFile}" alt="Firma Cliente"/>`;
    }

    //Logo Tenant
    let LogoTenant='';
    if(tenantData.logoUrl){
        LogoTenant = `<img src="${tenantData.logoUrl}" alt="Logo Tenant" class="logo-empresa" />`;
    }

    //Logo Cliente
    let LogoCliente='';
    if(report.ClienteId?.Logo){
        LogoCliente = `<img src="${report.ClienteId.Logo}" alt="Logo Cliente"  class="logo-cliente"/>`;
    }

    //Detalle de la revisión falla reportada, diagnóstico y acción tomada
    let detalleRevision='';
    if(report.accionTomada){    
        detalleRevision=
        `<div class="section">
            <div class="section-header">
                <div class="title">Detalle de Revisión</div>
            </div>
            <div class="actividades-grid">
                <div class="actividad-item"><strong>Falla Reportada:</strong>  <small>${report.fallaReportada ?? 'N/A'}</small></div>
                <div class="actividad-item"><strong>Diagnóstico:</strong>  <small>${report.diagnostico ?? 'N/A'}</small></div>
                <div class="actividad-item"><strong>Acción Tomada:</strong>  <small>${report.accionTomada ?? 'N/A'}</small></div>
            </div>
        </div>`
    }
  

    let observacion=''
    if(report.observacion){
        observacion=report.observacion
    }
    if(report.observacionEstadoFinal){
        observacion= //si ya hay una observación general, se concatena con la observación de estado final
        observacion ? `${observacion}\n\n, \n${report.observacionEstadoFinal}` : `\n${report.observacionEstadoFinal}`
    }


  let html = template;
  // replace placeholders
  Object.keys(map).forEach((k) => {
    const re = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
    html = html.replace(re, map[k] ?? 'N/A');
  });

    html = html.replace(/\{\{actividades\}\}/g, actividades);
    html = html.replace(/\{\{repuestos\}\}/g, repuestosHtml);
    html = html.replace(/\{\{firmaResponsable\}\}/g, firmaResponsableHtml);
    html = html.replace(/\{\{firmaCliente\}\}/g, firmaClienteHtml);
    html = html.replace(/\{\{logoTenant\}\}/g, LogoTenant);
    html = html.replace(/\{\{logoCliente\}\}/g, LogoCliente);
    html = html.replace(/\{\{accionTomada\}\}/g, detalleRevision);
    html = html.replace(/\{\{observaciones\}\}/g, observacion ? observacion.replace(/\n/g, '<br/>') : 'Ninguna');

  return html;
}

export { getHTMLTemplate, generateHTMLFromReport };


function renderActividades(actividadesRealizadas = []) {
  if (!Array.isArray(actividadesRealizadas) || actividadesRealizadas.length === 0) {
    return '';
  }

  let rows = '';

  for (let i = 0; i < actividadesRealizadas.length; i += 2) {
    const a1 = actividadesRealizadas[i];
    const a2 = actividadesRealizadas[i + 1];

    const renderItem = (a) => {
      if (!a) return '';
      const desc = a.descripcion ?? a.actividad ?? 'N/A';
      const obs = a.observaciones ?? '';

      return obs !== ''
        ? `<strong>${desc}</strong> : <small>${obs}</small>`
        : `<strong>${desc}</strong>`;
    };

    rows += `
      <tr>
        <td style="width:50%; vertical-align:top; padding-right:10px;">
          ${renderItem(a1)}
        </td>
        <td style="width:50%; vertical-align:top;">
          ${renderItem(a2)}
        </td>
      </tr>
    `;
  }

  return `
    <div class="section">
      <div class="section-header">
        <div class="title">Actividades Realizadas</div>
      </div>
      <table width="100%" cellspacing="0" cellpadding="0">
        ${rows}
      </table>
    </div>
  `;
}
