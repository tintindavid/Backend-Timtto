/**
 * tests/services/informeHtml.marca-footer.test.js
 *
 * Verifies the por-mes HTML renderer exposes the Marca column and the
 * footer signature image per openspec/changes/informes-por-ot-tab-con-firma-y-cumplimiento
 * (tasks.md 6.4). Pure function — no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildInformeHtml } from '../../src/services/informeHtml.service.js';

function basePayload(metaOverrides = {}) {
  return {
    meta: {
      clienteId: 'c1', clienteNombre: 'ACME S.A.S', clienteCiudad: 'Bogota', clienteLogo: null,
      periodoDesde: 'Enero', periodoHasta: 'Enero', periodoLabel: 'Enero 2026',
      fechaGeneracion: new Date().toISOString(), mesesSeleccionados: ['Enero'],
      tenantNombre: 'Tenant Demo', responsableNombre: 'Juan Perez', responsableFirmaUrl: null,
      ...metaOverrides,
    },
    kpis: {
      cumplimientoPreventivo: 100, totalProgramados: 1, totalRealizados: 1, totalCorrectivos: 0,
      totalRepuestosSolicitados: 0, totalRepuestosInstalados: 0, costoTotalRepuestos: 0, horasServicio: 1,
    },
    preventivos: [],
    correctivos: [],
    equipos: [{
      equipoId: 'e1', nombre: 'Monitor', marca: 'Philips', serie: 'S1', inventario: 'INV1',
      sede: 'Sede A', servicio: 'UCI', mesesMtto: ['Enero'], totalProgramados: 1, totalRealizados: 1,
      cumplimiento: 100, estadoOperativo: 'Operativo', costoRepuestos: 0,
    }],
    repuestos: [],
    costos: { repuestos: 0 },
    observaciones: [],
    observacionGeneral: '',
  };
}

describe('buildInformeHtml — Marca column', () => {
  it('the equipos table renders a Marca header and the equipo marca cell', () => {
    const html = buildInformeHtml(basePayload());
    assert.match(html, /<th>Marca<\/th>/);
    assert.match(html, /<td>Philips<\/td>/);
  });
});

describe('buildInformeHtml — footer signature', () => {
  it('renders an <img> in the footer when responsableFirmaUrl is present', () => {
    const html = buildInformeHtml(basePayload({ responsableFirmaUrl: 'https://cdn.example.com/firma.png' }));
    const footerStart = html.indexOf('report-footer');
    const footerHtml = html.slice(footerStart);
    assert.match(footerHtml, /<img src="https:\/\/cdn\.example\.com\/firma\.png"/);
  });

  it('omits the <img> in the footer when responsableFirmaUrl is null', () => {
    const html = buildInformeHtml(basePayload({ responsableFirmaUrl: null }));
    const footerStart = html.indexOf('report-footer');
    const footerHtml = html.slice(footerStart);
    assert.doesNotMatch(footerHtml, /<img/);
  });
});
