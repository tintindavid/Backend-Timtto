/**
 * tests/utils/activityOrigin.util.test.js
 *
 * Pure invariant helper for report.actividadesRealizadas[] sub-doc origins
 * (report-actividades-extra, spec: "Report sub-document integrity for
 * activities"). Reused by dtos/updateReport.dto.js and by
 * services/report.service.js#update — this test guards the source of truth
 * so both write paths stay in sync.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isValidActivityOrigin } from '../../src/utils/activityOrigin.util.js';

describe('isValidActivityOrigin', () => {
  it('accepts a protocol-originated entry (only actividadProtocoloId)', () => {
    assert.equal(isValidActivityOrigin({
      actividadProtocoloId: '507f1f77bcf86cd799439011',
      descripcion: 'x',
    }), true);
  });

  it('accepts an extra entry (actividadMttoId + esExtra:true)', () => {
    assert.equal(isValidActivityOrigin({
      actividadMttoId: '507f1f77bcf86cd799439022',
      esExtra: true,
      descripcion: 'x',
    }), true);
  });

  it('rejects an entry with BOTH origins set', () => {
    assert.equal(isValidActivityOrigin({
      actividadProtocoloId: '507f1f77bcf86cd799439011',
      actividadMttoId: '507f1f77bcf86cd799439022',
      esExtra: true,
    }), false);
  });

  it('rejects an entry with NEITHER origin set', () => {
    assert.equal(isValidActivityOrigin({
      descripcion: 'orphan',
    }), false);
  });

  it('rejects an entry with actividadMttoId but esExtra !== true', () => {
    assert.equal(isValidActivityOrigin({
      actividadMttoId: '507f1f77bcf86cd799439022',
      esExtra: false,
    }), false);
    assert.equal(isValidActivityOrigin({
      actividadMttoId: '507f1f77bcf86cd799439022',
      // esExtra undefined
    }), false);
  });

  it('treats empty-string actividadProtocoloId as "not set" (retro-compat)', () => {
    // Frontend historically sent '' when the protocol pointer was unknown;
    // hasValue('') must return false so ''-only entries fail the invariant.
    assert.equal(isValidActivityOrigin({ actividadProtocoloId: '' }), false);
  });
});
