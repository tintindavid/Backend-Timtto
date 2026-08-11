/**
 * tests/utils/filenameSanitize.util.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeFilenameSegment,
  resolveTokenValue,
  buildBulkPdfFilename,
} from '../../src/utils/filenameSanitize.util.js';

describe('sanitizeFilenameSegment', () => {
  it('folds accents via NFD normalization', () => {
    assert.equal(sanitizeFilenameSegment('Balón Intraaórtico'), 'Balon_Intraaortico');
  });

  it('strips Windows-reserved characters', () => {
    assert.equal(sanitizeFilenameSegment('OT/2026:001<>?'), 'OT2026001');
  });

  it('preserves hyphens (consecutivo shape)', () => {
    assert.equal(sanitizeFilenameSegment('OT-2026-001-1'), 'OT-2026-001-1');
  });

  it('collapses consecutive whitespace and underscore runs into a single underscore', () => {
    assert.equal(sanitizeFilenameSegment('  MONITOR   MULTI   '), 'MONITOR_MULTI');
    assert.equal(sanitizeFilenameSegment('a___b'), 'a_b');
  });

  it('trims leading/trailing underscores', () => {
    assert.equal(sanitizeFilenameSegment('___hello___'), 'hello');
  });

  it('preserves casing (uppercased items stay uppercased)', () => {
    assert.equal(sanitizeFilenameSegment('MONITOR MULTIPARAMETRO'), 'MONITOR_MULTIPARAMETRO');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(sanitizeFilenameSegment(null), '');
    assert.equal(sanitizeFilenameSegment(undefined), '');
  });
});

describe('resolveTokenValue', () => {
  const report = {
    _id: 'r1',
    consecutivo: 'OT-2026-001-1',
    equipoSnapshot: { Serie: 'SN12345', Inventario: 'INV-777', ItemText: 'MONITOR MULTIPARAMETRO' },
    fechaProcesado: '2026-08-11T14:30:00Z',
    createdAt: '2026-08-01T00:00:00Z',
  };

  it('resolves each token to the expected raw value', () => {
    assert.equal(resolveTokenValue(report, 'consecutivo'), 'OT-2026-001-1');
    assert.equal(resolveTokenValue(report, 'serial'), 'SN12345');
    assert.equal(resolveTokenValue(report, 'inventario'), 'INV-777');
    assert.equal(resolveTokenValue(report, 'item'), 'MONITOR MULTIPARAMETRO');
    assert.equal(resolveTokenValue(report, 'fecha'), '2026-08-11');
  });

  it('falls back to _id when consecutivo is missing', () => {
    assert.equal(resolveTokenValue({ _id: 'abc' }, 'consecutivo'), 'abc');
  });

  it('renders SN for missing serial/inventario/item', () => {
    const empty = { equipoSnapshot: {} };
    assert.equal(resolveTokenValue(empty, 'serial'), 'SN');
    assert.equal(resolveTokenValue(empty, 'inventario'), 'SN');
    assert.equal(resolveTokenValue(empty, 'item'), 'SN');
  });

  it('renders sin-fecha when all date candidates are absent', () => {
    assert.equal(resolveTokenValue({}, 'fecha'), 'sin-fecha');
  });

  it('picks fechaProcesado > fechaFinalizdo > createdAt', () => {
    assert.equal(
      resolveTokenValue({ fechaFinalizdo: '2026-08-10T00:00:00Z', createdAt: '2026-08-01T00:00:00Z' }, 'fecha'),
      '2026-08-10'
    );
    assert.equal(
      resolveTokenValue({ createdAt: '2026-08-01T00:00:00Z' }, 'fecha'),
      '2026-08-01'
    );
  });
});

describe('buildBulkPdfFilename', () => {
  const report = {
    consecutivo: 'OT-2026-001-1',
    equipoSnapshot: { Serie: 'SN12345', Inventario: 'INV-777', ItemText: 'MONITOR MULTIPARAMETRO' },
    fechaProcesado: '2026-08-11T14:30:00Z',
  };

  it('composes tokens in the requested order joined by underscore', () => {
    assert.equal(
      buildBulkPdfFilename(report, ['consecutivo', 'fecha', 'item']),
      'OT-2026-001-1_2026-08-11_MONITOR_MULTIPARAMETRO.pdf'
    );
  });

  it('respects a different order', () => {
    assert.equal(
      buildBulkPdfFilename(report, ['item', 'serial']),
      'MONITOR_MULTIPARAMETRO_SN12345.pdf'
    );
  });

  it('returns null on empty/null tokens', () => {
    assert.equal(buildBulkPdfFilename(report, []), null);
    assert.equal(buildBulkPdfFilename(report, null), null);
  });

  it('renders SN segments for missing values so structure stays intact', () => {
    const partial = { consecutivo: 'OT-1', equipoSnapshot: {} };
    assert.equal(buildBulkPdfFilename(partial, ['consecutivo', 'serial', 'inventario']), 'OT-1_SN_SN.pdf');
  });

  it('caps the pre-extension length at 120 chars', () => {
    const longItem = 'A'.repeat(200);
    const r = { consecutivo: 'OT-1', equipoSnapshot: { ItemText: longItem } };
    const name = buildBulkPdfFilename(r, ['consecutivo', 'item']);
    // 120-char cap + ".pdf" = 124 chars total
    assert.equal(name.length, 124);
    assert.ok(name.endsWith('.pdf'));
  });
});
