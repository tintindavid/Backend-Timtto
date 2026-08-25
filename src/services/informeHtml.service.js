'use strict';

// ─── CSS Vars & styles (static) ──────────────────────────────────────────────
// Exported so `informeHtmlByOt.service.js` can reuse the same palette/table
// CSS instead of duplicating it (design.md Group 4 note: "reuse styles").
export const BASE_STYLES = `
  :root {
    --primary-color: #1a2332;
    --secondary-color: #2c3e50;
    --accent-color: #ff6b35;
    --success-color: #27ae60;
    --warning-color: #f39c12;
    --danger-color:  #e74c3c;
    --info-color:    #3498db;
    --light-bg:      #f8f9fa;
    --border-color:  #e0e0e0;
    --text-primary:  #2c3e50;
    --text-secondary:#7f8c8d;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: var(--text-primary); background:#fff; line-height:1.4; font-size:12px; }
  .container { max-width:1200px; margin:0 auto; padding:10px 16px; }

  /* Header */
  .report-header { background:linear-gradient(135deg,var(--primary-color) 0%,var(--secondary-color) 100%); color:#fff; padding:35px; border-radius:12px; margin-bottom:28px; }
  .header-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:16px; }
  .company-logo { font-size:28px; font-weight:800; letter-spacing:-1px; }
  .report-period { text-align:right; }
  .report-period h1 { font-size:36px; font-weight:800; margin-bottom:4px; }
  .report-period p  { opacity:.9; font-size:14px; }
  .report-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-top:18px; padding-top:18px; border-top:1px solid rgba(255,255,255,.2); }
  .meta-item { display:flex; flex-direction:column; }
  .meta-label { font-size:11px; opacity:.8; text-transform:uppercase; letter-spacing:1px; margin-bottom:3px; }
  .meta-value { font-size:15px; font-weight:600; }
  .client-logo { max-height:60px; max-width:140px; object-fit:contain; border-radius:4px; }

  /* KPI Grid */
  .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin-bottom:14px; }
  .kpi-card { background:#fff; padding:12px 14px; border-radius:8px; border-left:4px solid var(--accent-color); box-shadow:0 2px 6px rgba(0,0,0,.06); }
  .kpi-card.success { border-left-color:var(--success-color); }
  .kpi-card.warning { border-left-color:var(--warning-color); }
  .kpi-card.danger  { border-left-color:var(--danger-color);  }
  .kpi-card.info    { border-left-color:var(--info-color);    }
  .kpi-label { font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; font-weight:600; }
  .kpi-value { font-size:20px; font-weight:700; color:var(--text-primary); line-height:1; margin-bottom:3px; }
  .kpi-description { font-size:10px; color:var(--text-secondary); }

  /* Section */
  .section { background:#fff; padding:14px 16px; border-radius:8px; margin-bottom:10px; box-shadow:0 2px 6px rgba(0,0,0,.06); }
  .section-title { font-size:14px; font-weight:700; color:var(--primary-color); margin-bottom:8px; padding-bottom:5px; border-bottom:2px solid var(--accent-color); display:flex; align-items:center; gap:8px; }
  .section-title::before { content:''; width:4px; height:16px; background:var(--accent-color); border-radius:2px; }

  /* CSS Bar Charts (PDF-safe, no JS) */
  .css-chart { margin:18px 0; }
  .css-chart-label { font-size:13px; font-weight:600; color:var(--primary-color); margin-bottom:12px; }
  .bar-row { display:flex; align-items:center; margin-bottom:10px; gap:10px; }
  .bar-name { font-size:12px; color:var(--text-secondary); width:140px; flex-shrink:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bar-track { flex:1; background:var(--light-bg); border-radius:20px; height:16px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:20px; background:var(--accent-color); min-width:2px; }
  .bar-fill.success { background:var(--success-color); }
  .bar-fill.info    { background:var(--info-color); }
  .bar-fill.warning { background:var(--warning-color); }
  .bar-fill.danger  { background:var(--danger-color); }
  .bar-value { font-size:12px; font-weight:600; color:var(--text-primary); width:46px; text-align:right; flex-shrink:0; }

  /* Tables */
  .data-table { width:100%; border-collapse:collapse; margin:16px 0; font-size:13px; }
  .data-table thead { background:var(--primary-color); color:#fff; }
  .data-table thead th { padding:12px 10px; text-align:left; font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:.5px; }
  .data-table tbody tr { border-bottom:1px solid var(--border-color); }
  .data-table tbody td { padding:12px 10px; }
  .data-table tbody tr:nth-child(even) { background:var(--light-bg); }
  .group-sede { background:var(--primary-color) !important; color:#fff; font-weight:700; text-transform:uppercase; font-size:11px; letter-spacing:1px; padding:8px 12px !important; }
  .group-servicio { background:#e8edf2 !important; color:#2c3e50; font-weight:600; font-size:11px; padding:5px 12px 5px 24px !important; }

  /* Status badges */
  .status-badge { display:inline-block; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; }
  .status-badge.realizado  { background:#d4edda; color:#155724; }
  .status-badge.programado { background:#fff3cd; color:#856404; }
  .status-badge.cancelado  { background:#f8d7da; color:#721c24; }
  .status-badge.instalado  { background:#d4edda; color:#155724; }
  .status-badge.solicitado { background:#d1ecf1; color:#0c5460; }
  .status-badge.cumplido   { background:#d4edda; color:#155724; }
  .status-badge.pendiente  { background:#fff3cd; color:#856404; }
  .status-badge.operativo             { background:#d4edda; color:#155724; }
  .status-badge.fuera-de-servicio     { background:#f8d7da; color:#721c24; }
  .status-badge.en-mantenimiento      { background:#d1ecf1; color:#0c5460; }
  .status-badge.espera-de-repuestos   { background:#fff3cd; color:#856404; }
  .status-badge.en-reparacion         { background:#fff3cd; color:#856404; }

  /* Section header (por-OT Sede/Servicio blocks) */
  .ot-section-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid var(--border-color); }
  .ot-section-title { font-size:12px; font-weight:700; color:var(--primary-color); }
  .pct-badge { display:inline-block; padding:3px 10px; border-radius:14px; font-size:11px; font-weight:700; color:#fff; }
  .pct-badge.success { background:var(--success-color); }
  .pct-badge.warning  { background:var(--warning-color); }
  .pct-badge.danger   { background:var(--danger-color); }
  .obs-line { font-size:11px; margin-bottom:4px; line-height:1.4; }
  /* Individual Sede/Servicio blocks — tighter vertical rhythm. */
  .ot-section-block { margin-bottom:10px; padding-bottom:6px; }
  .ot-section-block:last-child { margin-bottom:0; padding-bottom:0; }

  /* Summary */
  .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:16px; margin:18px 0; }
  .summary-card { background:var(--light-bg); padding:18px; border-radius:8px; border:1px solid var(--border-color); text-align:center; }
  .summary-card-value { font-size:30px; font-weight:700; color:var(--primary-color); margin-bottom:6px; }
  .summary-card-label { font-size:12px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:.5px; }

  /* Costs */
  .cost-breakdown { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin:16px 0; }
  .cost-item { background:var(--light-bg); padding:16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; }
  .cost-label { font-size:13px; color:var(--text-secondary); font-weight:500; }
  .cost-value { font-size:18px; font-weight:700; color:var(--primary-color); }

  /* Observations */
  .observation-list { list-style:none; padding:0; }
  .observation-item { padding:14px; margin-bottom:10px; border-left:4px solid var(--info-color); background:var(--light-bg); border-radius:4px; font-size:13px; color:var(--text-secondary); }
  .no-data { text-align:center; padding:30px; color:var(--text-secondary); font-style:italic; }

  /* Donut chart (CSS conic-gradient) */
  .donut-wrap { display:flex; align-items:center; gap:32px; margin:18px 0; flex-wrap:wrap; }
  .donut-ring { width:120px; height:120px; border-radius:50%; position:relative; flex-shrink:0; }
  .donut-center { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:18px; color:var(--primary-color); }
  .donut-inner { width:80px; height:80px; background:#fff; border-radius:50%; position:absolute; top:20px; left:20px; }

  /* Compact equipo cell */
  .eq-name { font-weight:600; font-size:13px; }
  .eq-meta { font-size:11px; color:var(--text-secondary); margin-top:2px; }

  /* Observación general */
  .obs-general { border-left:5px solid var(--accent-color); background:#fff8f5; padding:18px 20px; border-radius:6px; margin-bottom:18px; font-size:14px; line-height:1.7; }
  .obs-general-label { font-size:11px; font-weight:700; color:var(--accent-color); text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }

  /* Footer */
  .report-footer { margin-top:42px; padding:26px; background:var(--light-bg); border-radius:12px; }
  .signature-section { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:36px; margin-top:26px; }
  .signature-box { text-align:center; padding:16px; }
  .signature-line { border-top:2px solid var(--text-primary); margin:50px 16px 8px 16px; }
  .signature-name { font-weight:600; color:var(--primary-color); margin-bottom:2px; font-size:14px; }
  .signature-role { font-size:12px; color:var(--text-secondary); }

  @media print {
    body { background:#fff; }
    .container { max-width:100%; padding:16px; }
    .section, .kpi-card { page-break-inside:avoid; box-shadow:none; }
  }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
// esc / formatCOP / statusBadge are also exported for reuse by
// `informeHtmlByOt.service.js` (design.md Group 4 note: "reuse styles").

export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount || 0);
}

export function statusBadge(estado) {
  const cls = (estado || '').toLowerCase();
  return `<span class="status-badge ${cls}">${esc(estado)}</span>`;
}

function barChart(title, bars, colorClass = '') {
  if (!bars.length) return '';
  const max = Math.max(...bars.map(b => b.value), 1);
  const rows = bars.map(b => {
    const pct = Math.round((b.value / max) * 100);
    return `
      <div class="bar-row">
        <div class="bar-name" title="${esc(b.label)}">${esc(b.label)}</div>
        <div class="bar-track"><div class="bar-fill ${colorClass}" style="width:${pct}%"></div></div>
        <div class="bar-value">${b.display ?? b.value}</div>
      </div>`;
  }).join('');
  return `<div class="css-chart"><div class="css-chart-label">${esc(title)}</div>${rows}</div>`;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildHeader(meta) {
  const tenantLogoHtml = meta.tenantLogo
    ? `<img src="${esc(meta.tenantLogo)}" alt="${esc(meta.tenantNombre)}" style="max-height:60px;max-width:150px;" />`
    : '';
  const clienteLogoHtml = meta.clienteLogo
    ? `<img src="${esc(meta.clienteLogo)}" alt="${esc(meta.clienteNombre)}" style="max-height:60px;max-width:150px;" />`
    : '';

  return `
    <div class="tenant-header">
      <div class="th-side">${tenantLogoHtml}</div>
      <div class="th-center">
        <div class="th-title">${esc(meta.tenantNombre || 'TIMTTO')}</div>
        <div class="th-subtitle">ESPECIALISTAS EN BIOINGENIERÍA</div>
        <hr/>
        <div class="th-doc">INFORME MENSUAL DE MANTENIMIENTO — ${esc(meta.periodoLabel.toUpperCase())}</div>
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
        <div><span class="cg-label">Periodo:</span> <span class="cg-value">${esc(meta.periodoLabel)}</span></div>
      </div>
    </div>`;
}

function buildKPIs(kpis) {
  const cumColor = kpis.cumplimientoPreventivo >= 90 ? 'success' : kpis.cumplimientoPreventivo >= 70 ? 'warning' : 'danger';

  // Hide count/monetary cards when value=0 to keep the informe clean.
  const cards = [
    { html: `<div class="kpi-card ${cumColor}"><div class="kpi-label">Cumplimiento Preventivo</div><div class="kpi-value">${kpis.cumplimientoPreventivo}%</div><div class="kpi-description">${kpis.totalRealizados} de ${kpis.totalProgramados} realizados</div></div>`, show: true },
    { html: `<div class="kpi-card info"><div class="kpi-label">Mtto. Correctivos</div><div class="kpi-value">${kpis.totalCorrectivos}</div><div class="kpi-description">Intervenciones no programadas</div></div>`, show: kpis.totalCorrectivos > 0 },
    { html: `<div class="kpi-card warning"><div class="kpi-label">Repuestos Solicitados</div><div class="kpi-value">${kpis.totalRepuestosSolicitados}</div><div class="kpi-description">${kpis.totalRepuestosInstalados} instalados</div></div>`, show: kpis.totalRepuestosSolicitados > 0 },
    { html: `<div class="kpi-card danger"><div class="kpi-label">Costo Repuestos</div><div class="kpi-value" style="font-size:22px;">${formatCOP(kpis.costoTotalRepuestos)}</div><div class="kpi-description">Solo piezas instaladas</div></div>`, show: kpis.costoTotalRepuestos > 0 },
    { html: `<div class="kpi-card" style="border-left-color:#9b59b6;"><div class="kpi-label">Horas de Servicio</div><div class="kpi-value">${kpis.horasServicio} h</div><div class="kpi-description">Tiempo total de intervención</div></div>`, show: kpis.horasServicio > 0 },
  ];
  return `<div class="kpi-grid">${cards.filter(c => c.show).map(c => c.html).join('')}</div>`;
}

function buildResumenEjecutivo(kpis, meta) {
  const pendientes = kpis.totalProgramados - kpis.totalRealizados;
  const pct = kpis.cumplimientoPreventivo;
  const color = pct >= 90 ? '#27ae60' : pct >= 70 ? '#f39c12' : '#e74c3c';
  return `
    <div class="section">
      <h2 class="section-title">Resumen Ejecutivo</h2>
      <p style="margin-bottom:18px;line-height:1.8;">
        Durante el periodo <strong>${esc(meta.periodoLabel)}</strong>, se registraron
        <strong>${kpis.totalProgramados} mantenimientos preventivos programados</strong>,
        de los cuales <strong>${kpis.totalRealizados} fueron realizados</strong>, alcanzando un cumplimiento del
        <strong>${pct}%</strong>.
        Se atendieron además <strong>${kpis.totalCorrectivos} mantenimientos correctivos</strong>.
      </p>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-card-value">${kpis.totalProgramados}</div>
          <div class="summary-card-label">Prev. Programados</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-value">${kpis.totalRealizados}</div>
          <div class="summary-card-label">Prev. Realizados</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-value">${kpis.totalCorrectivos}</div>
          <div class="summary-card-label">Correctivos</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-value">${kpis.totalRepuestosSolicitados}</div>
          <div class="summary-card-label">Repuestos Solicitados</div>
        </div>
      </div>
      <div class="donut-wrap">
        <div class="donut-ring" style="background:conic-gradient(${color} ${pct}%, #e0e0e0 0);">
          <div class="donut-inner"></div>
          <div class="donut-center">${pct}%</div>
        </div>
        <div>
          <div style="font-size:13px;margin-bottom:6px;">
            <span style="display:inline-block;width:12px;height:12px;background:${color};border-radius:50%;margin-right:6px;"></span>
            Realizados: ${kpis.totalRealizados}
          </div>
          <div style="font-size:13px;">
            <span style="display:inline-block;width:12px;height:12px;background:#e0e0e0;border-radius:50%;margin-right:6px;"></span>
            Pendientes: ${pendientes}
          </div>
        </div>
      </div>
    </div>`;
}

function buildPreventivosTable(preventivos) {
  const rows = preventivos.length
    ? preventivos.map(r => {
        const meta = [r.marca, r.modelo].filter(Boolean).join(' — ');
        return `
        <tr>
          <td class="fw-bold">${esc(r.consecutivo)}</td>
          <td>
            <div class="eq-name">${esc(r.equipoNombre)}</div>
            ${meta ? `<div class="eq-meta">${meta}</div>` : ''}
          </td>
          <td>${esc(r.serie || '—')} / ${esc(r.inventario || '—')}</td>
          <td>${esc(r.sede)}</td>
          <td>${esc(r.fechaProgramada || '—')}</td>
          <td>${esc(r.fechaRealizado || '—')}</td>
          <td>${esc(r.tecnico || '—')}</td>
          <td>${statusBadge(r.estado)}</td>
          <td>${r.duracion} min</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="9" class="no-data">No hay mantenimientos preventivos registrados en este periodo</td></tr>`;

  const cumplimientoBars = preventivos.length
    ? (() => {
        const realizados = preventivos.filter(r => r.estado === 'Realizado').length;
        const programados = preventivos.filter(r => r.estado === 'Programado').length;
        const cancelados = preventivos.filter(r => r.estado === 'Cancelado').length;
        return barChart('Estado de Mantenimientos Preventivos', [
          { label: 'Realizados',  value: realizados,  display: String(realizados),  colorClass: 'success' },
          { label: 'Programados', value: programados, display: String(programados), colorClass: 'warning' },
          { label: 'Cancelados',  value: cancelados,  display: String(cancelados),  colorClass: 'danger'  },
        ]);
      })()
    : '';

  return `
    <div class="section">
      <h2 class="section-title">Mantenimientos Preventivos</h2>
      ${cumplimientoBars}
      <h3 style="margin:24px 0 12px;color:var(--primary-color);font-size:16px;">Detalle</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Reporte</th><th>Equipo</th><th>Serie / Inventario</th>
            <th>Sede</th><th>F. Programada</th><th>F. Realizado</th><th>Técnico</th><th>Estado</th><th>Duración</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildCorrectivosTable(correctivos) {
  const rows = correctivos.length
    ? correctivos.map(r => {
        const meta = [r.marca, r.modelo].filter(Boolean).join(' — ');
        return `
        <tr>
          <td class="fw-bold">${esc(r.consecutivo)}</td>
          <td>
            <div class="eq-name">${esc(r.equipoNombre)}</div>
            ${meta ? `<div class="eq-meta">${meta}</div>` : ''}
          </td>
          <td>${esc(r.serie || '—')} / ${esc(r.inventario || '—')}</td>
          <td>${esc(r.sede)}</td>
          <td>${esc(r.fechaProgramada || '—')}</td>
          <td>${esc(r.fechaCerrado || '—')}</td>
          <td>${esc(r.tecnico || '—')}</td>
          <td>${esc(r.diagnostico || '—')}</td>
          <td>${statusBadge(r.estado)}</td>
          <td>${r.duracion} min</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="10" class="no-data">No hay mantenimientos correctivos registrados en este periodo</td></tr>`;

  return `
    <div class="section">
      <h2 class="section-title">Mantenimientos Correctivos</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Reporte</th><th>Equipo</th><th>Serie / Inventario</th>
            <th>Sede</th><th>F. Apertura</th><th>F. Cierre</th><th>Técnico</th><th>Diagnóstico</th><th>Estado</th><th>Duración</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function groupEquiposForHtml(equipos) {
  const sorted = [...equipos].sort((a, b) => {
    const c1 = (a.sede || '(Sin sede)').localeCompare(b.sede || '(Sin sede)', 'es');
    if (c1) return c1;
    const c2 = (a.servicio || '(Sin servicio)').localeCompare(b.servicio || '(Sin servicio)', 'es');
    if (c2) return c2;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });
  const items = [];
  let lastSede = null;
  let lastServicio = null;
  for (const eq of sorted) {
    const sede = eq.sede || '(Sin sede)';
    const servicio = eq.servicio || '(Sin servicio)';
    if (sede !== lastSede) { items.push({ type: 'sede', label: sede }); lastSede = sede; lastServicio = null; }
    if (servicio !== lastServicio) { items.push({ type: 'servicio', label: servicio }); lastServicio = servicio; }
    items.push({ type: 'equipo', eq });
  }
  return items;
}

function buildEquiposSection(equipos) {
  const COL = 10;
  const grouped = groupEquiposForHtml(equipos);
  const rows = grouped.length
    ? grouped.map(item => {
        if (item.type === 'sede') {
          return `<tr><td colspan="${COL}" class="group-sede">📍 ${esc(item.label)}</td></tr>`;
        }
        if (item.type === 'servicio') {
          return `<tr><td colspan="${COL}" class="group-servicio">&nbsp;&nbsp;&nbsp;⚙ ${esc(item.label)}</td></tr>`;
        }
        const eq = item.eq;
        return `
          <tr>
            <td>${esc(eq.inventario || '—')}</td>
            <td>${esc(eq.nombre)}</td>
            <td>${esc(eq.marca)}</td>
            <td>${esc(eq.sede || '—')}</td>
            <td>${esc(eq.servicio || '—')}</td>
            <td>${eq.totalProgramados}</td>
            <td>${eq.totalRealizados}</td>
            <td>${eq.cumplimiento}%</td>
            <td>${formatCOP(eq.costoRepuestos)}</td>
            <td>${esc(eq.estadoOperativo)}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="${COL}" class="no-data">No hay equipos en este periodo</td></tr>`;

  return `
    <div class="section">
      <h2 class="section-title">Inventario de Equipos</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Inventario</th><th>Equipo</th><th>Marca</th><th>Sede</th>
            <th>Servicio</th><th>Prog.</th><th>Real.</th>
            <th>Cumpl.</th><th>Costo Rep.</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildRepuestosSection(repuestos) {
  const rows = repuestos.length
    ? repuestos.map(r => `
        <tr>
          <td>${esc(r.nombre)}</td>
          <td>${esc(r.equipo || '—')}</td>
          <td>${r.cantidad}</td>
          <td>${statusBadge(r.estado)}</td>
          <td>${formatCOP(r.precioUnitario)}</td>
          <td>${formatCOP(r.precioTotal)}</td>
          <td>${esc(r.fechaSolicitud || '—')}</td>
          <td>${esc(r.fechaInstalacion || '—')}</td>
        </tr>`).join('')
    : `<tr><td colspan="8" class="no-data">No hay repuestos en este periodo</td></tr>`;

  return `
    <div class="section">
      <h2 class="section-title">Repuestos y Materiales</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Repuesto</th><th>Equipo</th><th>Cantidad</th><th>Estado</th>
            <th>Precio Unit.</th><th>Precio Total</th><th>F. Solicitud</th><th>F. Instalación</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildCostosSection(costos, repuestos) {
  const instalados = repuestos.filter(r => (r.estado || '').toLowerCase() === 'instalado');
  const bars = instalados.length
    ? barChart('Top repuestos por costo', instalados
        .sort((a, b) => (b.precioTotal || 0) - (a.precioTotal || 0))
        .slice(0, 8)
        .map(r => ({ label: r.nombre, value: r.precioTotal, display: formatCOP(r.precioTotal) }))
      )
    : '';

  return `
    <div class="section">
      <h2 class="section-title">Análisis de Costos</h2>
      <div class="cost-breakdown">
        <div class="cost-item">
          <span class="cost-label">Costo Total Repuestos Instalados</span>
          <span class="cost-value">${formatCOP(costos.repuestos)}</span>
        </div>
      </div>
      ${bars}
    </div>`;
}

function buildObservacionesSection(observaciones, observacionGeneral = '') {
  const obsGeneralHtml = observacionGeneral
    ? `<div class="obs-general"><div class="obs-general-label">Observación General</div>${esc(observacionGeneral)}</div>`
    : '';
  const items = observaciones.length
    ? observaciones.map(obs => `<li class="observation-item">${esc(obs)}</li>`).join('')
    : `<li class="no-data">Sin observaciones registradas en este periodo</li>`;

  return `
    <div class="section">
      <h2 class="section-title">Observaciones</h2>
      ${obsGeneralHtml}
      <ul class="observation-list">${items}</ul>
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
 * Builds a complete HTML report string from an InformePayload.
 * No JavaScript (Chart.js) is included so it renders correctly in the
 * Puppeteer-based PDF microservice.
 *
 * @param {object} payload  - InformePayload from informeGenerateService.generate()
 * @returns {string}        - Full HTML document
 */
export function buildInformeHtml(payload) {
  const { meta, kpis, preventivos, correctivos, equipos, repuestos, costos, observaciones, observacionGeneral = '' } = payload;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Informe de Mantenimiento — ${esc(meta.periodoLabel)}</title>
  <style>${BASE_STYLES}
    .tenant-header { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; margin-bottom:10px; border:1.5px solid #1a2332; border-radius:5px; background:#ffffff; }
    .tenant-header .th-side { width:110px; }
    .tenant-header .th-side img { max-height:38px; max-width:110px; }
    .tenant-header .th-right { text-align:right; }
    .tenant-header .th-center { flex:1; text-align:center; }
    .tenant-header .th-title { font-size:13px; font-weight:800; color:#1a2332; letter-spacing:0.4px; }
    .tenant-header .th-subtitle { font-size:8px; color:#6c757d; letter-spacing:1.5px; margin-top:1px; }
    .tenant-header hr { margin:3px 0; border:0; border-top:1px solid #dee2e6; }
    .tenant-header .th-doc { font-size:11px; font-weight:700; color:#1a2332; letter-spacing:0.6px; }
    .cliente-grid { display:grid; grid-template-columns:1fr 1fr; gap:3px 16px; font-size:11px; padding:8px 12px; background:#f8f9fa; border-radius:4px; }
    .cliente-grid .cg-label { font-weight:600; color:#495057; }
    .cliente-grid .cg-value { color:#212529; }
    .fw-bold { font-weight:700; }
    /* Per-page tenant footer (same table trick as the reporte PDF). */
    @page { size: A4 portrait; margin: 10mm 8mm 18mm 8mm; }
    @media print {
      .page-wrapper thead { display: table-header-group; }
      .page-wrapper tfoot { display: table-footer-group; }
      .page-wrapper tbody { display: table-row-group; }
    }
    .page-wrapper { width:100%; border-collapse:collapse; }
    .page-wrapper td { padding:0; border:none; }
    .tenant-page-footer { text-align:center; font-size:9.5px; color:#6c757d; padding:6px 0; border-top:1px solid #dee2e6; }
  </style>
</head>
<body>
  <table class="page-wrapper">
    <tbody>
      <tr>
        <td>
          <div class="container">
            ${buildHeader(meta)}
            ${buildKPIs(kpis)}
            ${buildResumenEjecutivo(kpis, meta)}
            ${buildPreventivosTable(preventivos)}
            ${buildCorrectivosTable(correctivos)}
            ${buildEquiposSection(equipos)}
            ${buildRepuestosSection(repuestos)}
            ${buildCostosSection(costos, repuestos)}
            ${buildObservacionesSection(observaciones, observacionGeneral)}
            ${buildFooter(meta)}
          </div>
        </td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td>
          <div class="tenant-page-footer">
            ${buildTenantPageFooterMes(meta)}
          </div>
        </td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}

/**
 * Repeated per-page footer for the por-mes PDF — same format as the reporte
 * PDF and the por-ot PDF: `<Nombre>· <dirección> <ciudad> - <departamento> · <telefono>· <email>`.
 * Segments with empty values collapse.
 */
function buildTenantPageFooterMes(meta) {
  const parts = [];
  if (meta.tenantNombre) parts.push(esc(meta.tenantNombre));
  const ubicacion = [meta.tenantDireccion, [meta.tenantCiudad, meta.tenantDepartamento].filter(Boolean).join(' - ')]
    .filter(Boolean).join(' ');
  if (ubicacion) parts.push(esc(ubicacion));
  if (meta.tenantTelefono) parts.push(esc(meta.tenantTelefono));
  if (meta.tenantEmail) parts.push(esc(meta.tenantEmail));
  return parts.join(' · ');
}
