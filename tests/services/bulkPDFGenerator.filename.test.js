/**
 * tests/services/bulkPDFGenerator.filename.test.js
 *
 * Focuses on generateFileName routing (config-driven vs legacy fallback).
 * Instantiates the generator with an in-memory pdfClient stub so we never
 * touch the microservice.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import BulkPDFGenerator from '../../src/services/bulkPDFGenerator.js';

const stubClient = { healthCheck: async () => true, generatePDF: async () => Buffer.from('') };

const report = {
  consecutivo: 'OT-2026-001-1',
  equipoSnapshot: { Serie: 'SN12345', Inventario: 'INV-777', ItemText: 'MONITOR MULTIPARAMETRO' },
  fechaProcesado: '2026-08-11T14:30:00Z',
};

describe('BulkPDFGenerator#generateFileName', () => {
  it('uses the configured tokens when fileNameConfig is present', () => {
    const gen = new BulkPDFGenerator(stubClient);
    gen.fileNameConfig = { tokens: ['consecutivo', 'fecha', 'item'] };
    assert.equal(
      gen.generateFileName(report, 0),
      'OT-2026-001-1_2026-08-11_MONITOR_MULTIPARAMETRO.pdf'
    );
  });

  it('respects a reordered token list', () => {
    const gen = new BulkPDFGenerator(stubClient);
    gen.fileNameConfig = { tokens: ['item', 'consecutivo', 'serial'] };
    assert.equal(
      gen.generateFileName(report, 0),
      'MONITOR_MULTIPARAMETRO_OT-2026-001-1_SN12345.pdf'
    );
  });

  it('falls back to the legacy pattern when fileNameConfig is missing', () => {
    const gen = new BulkPDFGenerator(stubClient);
    // No fileNameConfig set — legacy `${consecutivo} ${ItemText} ${Inventario}.pdf`
    const name = gen.generateFileName(report, 0);
    assert.equal(name, 'OT-2026-001-1 MONITOR_MULTIPARAMETRO INV-777.pdf');
  });

  it('falls back to the legacy pattern when tokens is an empty array', () => {
    const gen = new BulkPDFGenerator(stubClient);
    gen.fileNameConfig = { tokens: [] };
    const name = gen.generateFileName(report, 0);
    assert.match(name, /^OT-2026-001-1 MONITOR_MULTIPARAMETRO INV-777\.pdf$/);
  });
});
