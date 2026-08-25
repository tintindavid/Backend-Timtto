'use strict';
import { BASE_STYLES, esc, formatCOP } from './informeHtml.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slug(str) {
  return String(str || '').toLowerCase().trim().replace(/\s+/g, '-');
}

function badge(label) {
  return `<span class="status-badge ${slug(label)}">${esc(label)}</span>`;
}

function pctBadge(pct) {
  if (pct === '—' || pct === null || pct === undefined) {
    return `<span class="pct-badge" style="background:#95a5a6;">—</span>`;
  }
  const cls = pct >= 90 ? 'success' : pct >= 60 ? 'warning' : 'danger';
  return `<span class="pct-badge ${cls}">${pct}%</span>`;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildHeader(meta) {
  const tenantLogoHtml = meta.tenantLogo
    ? `<img src="${esc(meta.tenantLogo)}" alt="${esc(meta.tenantNombre)}" style="max-height:60px;max-width:150px;" />`
    : '';
  const clienteLogoHtml = meta.clienteLogo
    ? `<img src="${esc(meta.clienteLogo)}" alt="${esc(meta.clienteNombre)}" style="max-height:60px;max-width:150px;" />`
    : '';

  const otsRows = (meta.otsSeleccionadas || []).length
    ? meta.otsSeleccionadas.map(ot => `
        <tr>
          <td>${esc(ot.consecutivo)}</td>
          <td>${esc(ot.tipoServicio)}</td>
          <td>${esc(ot.fechaCreacion || '—')}</td>
          <td>${esc(ot.estadoOt)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="no-data">Sin OTs seleccionadas</td></tr>`;

  return `
    <div class="tenant-header">
      <div class="th-side">${tenantLogoHtml}</div>
      <div class="th-center">
        <div class="th-title">${esc(meta.tenantNombre || 'TIMTTO')}</div>
        <div class="th-subtitle">ESPECIALISTAS EN BIOINGENIERÍA</div>
        <hr/>
        <div class="th-doc">INFORME DE CUMPLIMIENTO POR ORDEN DE TRABAJO</div>
      </div>
      <div class="th-side th-right">${clienteLogoHtml}</div>
    </div>

    <div class="section">
      <h2 class="section-title">Información del Cliente</h2>
      <div class="cliente-grid">
        <div><span class="cg-label">Cliente:</span> <span class="cg-value">${esc(meta.clienteNombre || '—')}</span></div>
        <div><span class="cg-label">NIT:</span> <span class="cg-value">${esc(meta.clienteNit || '—')}</span></div>
        <div><span class="cg-label">Ciudad:</span> <span class="cg-value">${esc([meta.clienteCiudad, meta.clienteDepartamento].filter(Boolean).join(', ') || '—')}</span></div>
        <div><span class="cg-label">Dirección:</span> <span class="cg-value">${esc(meta.clienteDireccion || '—')}</span></div>
        <div><span class="cg-label">Teléfono:</span> <span class="cg-value">${esc(meta.clienteTelefono || '—')}</span></div>
        <div><span class="cg-label">Email:</span> <span class="cg-value">${esc(meta.clienteEmail || '—')}</span></div>
        <div><span class="cg-label">Contacto:</span> <span class="cg-value">${esc(meta.clienteContacto || '—')}</span></div>
        <div><span class="cg-label">Generado:</span> <span class="cg-value">${new Date(meta.fechaGeneracion).toLocaleDateString('es-CO')}</span></div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Órdenes de Trabajo Incluidas</h2>
      <table class="data-table">
        <thead>
          <tr><th>Consecutivo</th><th>Tipo de Servicio</th><th>Fecha de Creación</th><th>Estado OT</th></tr>
        </thead>
        <tbody>${otsRows}</tbody>
      </table>
    </div>`;
}

function buildKPIs(kpis) {
  const pct = kpis.cumplimientoPct;
  const cumColor = pct === null ? '' : pct >= 90 ? 'success' : pct >= 60 ? 'warning' : 'danger';
  const cumDisplay = pct === null ? '—' : `${pct}%`;

  // Hide count cards when value = 0 to keep the informe clean.
  const cards = [
    { html: `<div class="kpi-card ${cumColor}"><div class="kpi-label">Cumplimiento</div><div class="kpi-value">${cumDisplay}</div><div class="kpi-description">${kpis.cumplidos} de ${kpis.totalReportes} (excl. cancelados)</div></div>`, show: true },
    { html: `<div class="kpi-card success"><div class="kpi-label">Cumplidos</div><div class="kpi-value">${kpis.cumplidos}</div><div class="kpi-description">Reportes cumplidos</div></div>`, show: kpis.cumplidos > 0 },
    { html: `<div class="kpi-card warning"><div class="kpi-label">Pendientes</div><div class="kpi-value">${kpis.pendientes}</div><div class="kpi-description">Reportes pendientes</div></div>`, show: kpis.pendientes > 0 },
    { html: `<div class="kpi-card danger"><div class="kpi-label">Cancelados</div><div class="kpi-value">${kpis.cancelados}</div><div class="kpi-description">Excluidos del cumplimiento</div></div>`, show: kpis.cancelados > 0 },
    { html: `<div class="kpi-card info"><div class="kpi-label">Mtto. Correctivos</div><div class="kpi-value">${kpis.correctivos}</div><div class="kpi-description">Intervenciones no programadas</div></div>`, show: kpis.correctivos > 0 },
    { html: `<div class="kpi-card" style="border-left-color:#9b59b6;"><div class="kpi-label">Repuestos Instalados</div><div class="kpi-value">${kpis.repuestosInstalados}</div></div>`, show: kpis.repuestosInstalados > 0 },
    { html: `<div class="kpi-card danger"><div class="kpi-label">Costo Repuestos</div><div class="kpi-value" style="font-size:22px;">${formatCOP(kpis.costoTotal)}</div><div class="kpi-description">Solo piezas instaladas</div></div>`, show: kpis.costoTotal > 0 },
    { html: `<div class="kpi-card" style="border-left-color:#9b59b6;"><div class="kpi-label">Horas de Servicio</div><div class="kpi-value">${kpis.horasServicio} h</div><div class="kpi-description">Tiempo total de intervención</div></div>`, show: kpis.horasServicio > 0 },
  ];
  return `<div class="kpi-grid">${cards.filter(c => c.show).map(c => c.html).join('')}</div>`;
}

function buildEquiposTable(rows) {
  const COL = 10;
  const body = rows.length
    ? rows.map(r => `
        <tr>
          <td class="fw-bold">${esc(r.consecutivo)}</td>
          <td>${esc(r.otConsecutivo)}</td>
          <td>
            <div class="eq-name">${esc(r.equipoNombre)} ${r.marca ? `— ${esc(r.marca)}` : ''}</div>
            ${r.modelo ? `<div class="eq-meta">Modelo: ${esc(r.modelo)}</div>` : ''}
          </td>
          <td>${esc(r.serie || '—')} / ${esc(r.inventario || '—')}</td>
          <td>${esc(r.ubicacion || '—')}</td>
          <td>${badge(r.estadoOperativo)}</td>
          <td>${badge(r.estadoReporte)}</td>
          <td>${esc(r.fechaProgramada || '—')}</td>
          <td>${esc(r.fechaRealizado || '—')}</td>
          <td>${esc(r.tecnico || '—')}</td>
        </tr>`).join('')
    : `<tr><td colspan="${COL}" class="no-data">No hay equipos/reportes en esta sección</td></tr>`;

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Reporte</th><th>OT</th><th>Equipo</th><th>Serie/Inventario</th><th>Ubicación</th>
          <th>Estado Operativo</th><th>Estado del reporte</th>
          <th>F. Programada</th><th>F. Realizado</th><th>Técnico</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function buildRepuestosTable(repuestos) {
  if (!repuestos.length) return '';
  const rows = repuestos.map(r => `
    <tr>
      <td>${esc(r.reporteConsecutivo)}</td>
      <td>${esc(r.equipo || '—')}</td>
      <td>${esc(r.repuesto)}</td>
      <td>${r.cantidad}</td>
      <td>${badge(r.estado)}</td>
      <td>${formatCOP(r.precio)}</td>
      <td>${esc(r.fecha || '—')}</td>
      <td style="font-size:11px;">${esc(r.observacion || '—')}</td>
    </tr>`).join('');

  return `
    <h3 style="margin:20px 0 10px;color:var(--primary-color);font-size:15px;">Repuestos</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Reporte</th><th>Equipo</th><th>Repuesto</th><th>Cantidad</th>
          <th>Estado</th><th>Precio</th><th>Fecha</th><th>Observación</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildSecciones(secciones) {
  if (!secciones.length) {
    return `<div class="section"><p class="no-data">No hay secciones para el alcance seleccionado</p></div>`;
  }
  return secciones.map(sec => `
    <div class="section">
      <div class="ot-section-header">
        <div class="ot-section-title">${esc(sec.sede)} / ${esc(sec.servicio)}</div>
        ${pctBadge(sec.cumplimientoPct)}
      </div>
      ${buildEquiposTable(sec.reportes)}
      ${buildRepuestosTable(sec.repuestos)}
    </div>`).join('');
}

function buildObservaciones(observacionesReportes, observacionGeneral = '') {
  const lines = (observacionesReportes || [])
    .map(o => `<p class="obs-line"><strong>${esc(o.consecutivo)}</strong> <em>"${esc(o.estadoOperativo)}"</em>: ${esc(o.observacion)}</p>`)
    .join('');

  const generalHtml = observacionGeneral
    ? `<div class="obs-general"><div class="obs-general-label">Observación General</div>${esc(observacionGeneral)}</div>`
    : '';

  return `
    <div class="section">
      <h2 class="section-title">Observaciones</h2>
      ${lines || `<p class="no-data">Sin observaciones registradas</p>`}
      ${generalHtml}
    </div>`;
}

function buildFooter(meta) {
  const firmaImg = meta.responsableFirmaUrl
    ? `<img src="${esc(meta.responsableFirmaUrl)}" alt="Firma" style="max-height:60px;max-width:200px;object-fit:contain;margin-bottom:6px;" />`
    : '';
  return `
    <div class="report-footer">
      <p style="text-align:center;color:var(--text-secondary);font-size:13px;">
        Informe generado el ${new Date(meta.fechaGeneracion).toLocaleString('es-CO')} — ${esc(meta.tenantNombre)}
      </p>
      <div class="signature-section">
        <div class="signature-box">
          ${firmaImg}
          <div class="signature-line"></div>
          <div class="signature-name">${esc(meta.responsableNombre || 'Técnico Responsable')}</div>
          <div class="signature-role">Responsable de Mantenimiento</div>
        </div>
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-name">${esc(meta.clienteNombre)}</div>
          <div class="signature-role">Representante del Cliente</div>
        </div>
      </div>
    </div>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a complete HTML document for the by-OT informe PDF.
 * Mirrors `informeHtml.service.js#buildInformeHtml` structure/style.
 *
 * @param {object} payload - InformePorOtPayload from informeGenerateByOt.service.js
 * @returns {string} Full HTML document
 */
export function buildInformeHtmlByOt(payload) {
  const { meta, kpis, secciones, observacionesReportes, observacionGeneral = '' } = payload;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Informe de Cumplimiento por OT — ${esc(meta.clienteNombre)}</title>
  <style>${BASE_STYLES}
    .tenant-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; margin-bottom:16px; border:2px solid #1a2332; border-radius:6px; background:#ffffff; }
    .tenant-header .th-side { width:150px; }
    .tenant-header .th-right { text-align:right; }
    .tenant-header .th-center { flex:1; text-align:center; }
    .tenant-header .th-title { font-size:20px; font-weight:800; color:#1a2332; letter-spacing:0.5px; }
    .tenant-header .th-subtitle { font-size:10px; color:#6c757d; letter-spacing:2px; margin-top:2px; }
    .tenant-header hr { margin:8px 0; border:0; border-top:1px solid #dee2e6; }
    .tenant-header .th-doc { font-size:13px; font-weight:700; color:#1a2332; letter-spacing:1px; }
    .cliente-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; font-size:12px; padding:12px 16px; background:#f8f9fa; border-radius:4px; }
    .cliente-grid .cg-label { font-weight:600; color:#495057; }
    .cliente-grid .cg-value { color:#212529; }
    .fw-bold { font-weight:700; }
  </style>
</head>
<body>
  <div class="container">
    ${buildHeader(meta)}
    ${buildKPIs(kpis)}
    ${buildSecciones(secciones)}
    ${buildObservaciones(observacionesReportes, observacionGeneral)}
    ${buildFooter(meta)}
  </div>
</body>
</html>`;
}
