import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HVEquipoPDFService } from '../../src/services/hvequipoPDF.service.js';

const svc = new HVEquipoPDFService();
const tenant = { name: 'Tenant', direccion: 'Calle 1', ciudad: 'Bogota', departamento: 'Cundinamarca', telefono: '1', email: 'a@b.co' };
const base = {
  _id: '507f1f77bcf86cd799439011',
  clienteId: { Razonsocial: 'Clinica X' },
  equipoSnapshot: { ItemText: 'Computador' },
  createdAt: new Date('2026-01-02'),
};

describe('hvequipoPDF helpers', () => {
  it('formatDate(null) and formatCurrency(null) return empty string', () => {
    assert.equal(svc.formatDate(null), '');
    assert.equal(svc.formatDate('nope'), '');
    assert.equal(svc.formatCurrency(null), '');
  });

  it('renderField omits empty values and legacy N/A', () => {
    for (const v of [null, undefined, '', '  ', 'N/A', [], {}]) {
      assert.equal(svc.renderField('X', v), '');
    }
    assert.match(svc.renderField('X', 'ok'), /field-value">ok</);
  });

  it('renderSection collapses blank content', () => {
    assert.equal(svc.renderSection('T', '  \n '), '');
    assert.match(svc.renderSection('Titulo', '<p>a</p>'), /Titulo/);
  });
});

describe('hvequipoPDF.generateHTML', () => {
  it('minimal HV: no N/A and empty sections omitted', () => {
    const html = svc.generateHTML({ ...base, Documentos: [{ nombre: 'Manual', link: 'https://x.test/m.pdf' }] }, tenant);
    assert.equal(html.includes('N/A'), false);
    assert.match(html, /Clinica X/);
    assert.match(html, /Manual/);
    for (const t of ['Información del Proveedor', 'Datos Técnico', 'Accesorios', 'Otras Especificaciones', 'Metrología', 'Recomendaciones de Uso', 'Fechas Importantes']) {
      assert.equal(html.includes(t), false, `unexpected section ${t}`);
    }
  });

  it('null tenantData does not throw', () => {
    assert.doesNotThrow(() => svc.generateHTML(base, null));
  });

  it('renders Otras Especificaciones between technical and maintenance sections', () => {
    const html = svc.generateHTML({
      ...base, Voltaje: '110', PeriodicidadMantenimiento: 'Anual',
      OtrasEspecificaciones: [{ nombre: 'RAM', valor: '16 GB' }],
    }, tenant);
    const iEsp = html.indexOf('Otras Especificaciones');
    assert.ok(iEsp > html.indexOf('Datos Técnico'));
    assert.ok(iEsp < html.indexOf('Metrología y Mantenimiento'));
    assert.match(html, /<span class="field-label">RAM:<\/span>\s*<span class="field-value">16 GB<\/span>/);
    assert.equal(html.includes('<td>RAM</td>'), false, 'must not render as a table');
  });

  it('escapes the user-provided specification name used as label', () => {
    const html = svc.generateHTML({
      ...base, OtrasEspecificaciones: [{ nombre: '<b>x</b>', valor: '1' }],
    }, tenant);
    assert.equal(html.includes('<b>x</b>'), false);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;:/);
  });

  it('renders the institution phone from TelContacto', () => {
    const html = svc.generateHTML({ ...base, clienteId: { Razonsocial: 'Clinica X', TelContacto: '3001234567' } }, tenant);
    assert.match(html, /Teléfono:<\/span>\s*<span class="field-value">3001234567</);
  });

  it('shows periodicity in months, keeping legacy free text untouched', () => {
    const numeric = svc.generateHTML({ ...base, PeriodicidadCalibracion: '12', PeriodicidadMantenimiento: '1' }, tenant);
    assert.match(numeric, /Periodicidad Calibración:<\/span>\s*<span class="field-value">12 meses</);
    assert.match(numeric, /Mantenimiento Preventivo:<\/span>\s*<span class="field-value">1 mes</);
    const legacy = svc.generateHTML({ ...base, PeriodicidadMantenimiento: 'Semestral' }, tenant);
    assert.match(legacy, /Mantenimiento Preventivo:<\/span>\s*<span class="field-value">Semestral</);
  });

  it('lists documents of both categories in Documentos Adjuntos', () => {
    const html = svc.generateHTML({
      ...base,
      Documentos: [
        { nombre: 'Manual general', link: 'https://x.test/m' },
        { nombre: 'Guia adjunta', categoria: 'guia_rapida', link: 'https://x.test/g' },
      ],
    }, tenant);
    assert.match(html, /Manual general/);
    assert.match(html, /Guia adjunta/);
  });

  it('never renders non-http(s) document URLs as links', () => {
    const html = svc.generateHTML({
      ...base,
      Documentos: [
        { nombre: 'Malo', link: 'javascript:alert(1)', archivoUrl: 'data:text/html;base64,AAAA' },
        { nombre: 'Bueno', link: 'https://ok.test/a' },
      ],
    }, tenant);
    assert.equal(/href="javascript:/i.test(html), false);
    assert.equal(/href="data:/i.test(html), false);
    assert.match(html, /<a href="https:\/\/ok.test\/a">/);
  });

  it('escapeHtml also escapes single quotes', () => {
    assert.equal(svc.escapeHtml(`a'b"c<d>&`), 'a&#39;b&quot;c&lt;d&gt;&amp;');
  });

  it('renders Documentos Adjuntos with links and blank cells, after Recomendaciones', () => {
    const html = svc.generateHTML({
      ...base,
      Recomendaciones: ['Limpiar'],
      Documentos: [
        { nombre: 'Solo link', link: 'https://x.test/a' },
        { nombre: 'Solo archivo', archivoUrl: 'https://fb.test/f.pdf', mimetype: 'application/pdf' },
      ],
    }, tenant);
    assert.ok(html.indexOf('Documentos Adjuntos') > html.indexOf('Recomendaciones de Uso'));
    assert.ok(html.indexOf('Documentos Adjuntos') < html.indexOf('signature-section">'));
    assert.match(html, /<a href="https:\/\/x.test\/a">https:\/\/x.test\/a<\/a>/);
    assert.match(html, /<a href="https:\/\/fb.test\/f.pdf">Descargar<\/a>/);
    assert.match(html, /<td>Solo link<\/td><td><a[^>]*>[^<]*<\/a><\/td><td><\/td>/);
    assert.equal(html.includes('N/A'), false);
  });

  it('does not render deprecated DocumentoAdjunto/ManualDisponible/PlanoDisponible', () => {
    const html = svc.generateHTML({ ...base, DocumentoAdjunto: 'https://legacy.test/x', ManualDisponible: true, PlanoDisponible: true }, tenant);
    assert.equal(html.includes('legacy.test'), false);
    assert.equal(/Manual|Plano/.test(html.replace(/<style>[\s\S]*<\/style>/, '')), false);
  });

  it('escapes user-provided HTML', () => {
    const html = svc.generateHTML({ ...base, Descripcion: '<script>alert(1)</script>' }, tenant);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
  });

  it('generateFileName is unchanged for existing HVs', () => {
    const name = svc.generateFileName({ clienteId: { Razonsocial: 'Clinica X' }, equipoSnapshot: { ItemText: 'Equipo 1' } });
    assert.match(name, /^HV_Clinica_X_Equipo_1_\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
