/**
 * tests/integration/bulkPdfReports.routes.dto.test.js
 *
 * DTO-level validation for POST /api/v1/pdf-reports/bulk. Exercises the Joi
 * schema directly — no controller, no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bulkPdfReportsDto } from '../../src/dtos/bulkPdfReports.dto.js';

const VALID_ID = '507f1f77bcf86cd799439010';

async function validate(body) {
  try {
    return { ok: true, value: await bulkPdfReportsDto.validateAsync(body) };
  } catch (err) {
    return { ok: false, err };
  }
}

describe('bulkPdfReportsDto', () => {
  it('accepts a valid { sheetworkId, fileNameConfig } payload', async () => {
    const res = await validate({
      sheetworkId: VALID_ID,
      fileNameConfig: { tokens: ['consecutivo', 'fecha', 'item'] },
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value.fileNameConfig.tokens, ['consecutivo', 'fecha', 'item']);
  });

  it('accepts an omitted fileNameConfig (backward compatibility)', async () => {
    const res = await validate({ sheetworkId: VALID_ID });
    assert.equal(res.ok, true);
    assert.equal(res.value.fileNameConfig, undefined);
  });

  it('rejects duplicate tokens', async () => {
    const res = await validate({
      sheetworkId: VALID_ID,
      fileNameConfig: { tokens: ['fecha', 'fecha', 'item'] },
    });
    assert.equal(res.ok, false);
    assert.match(res.err.message, /duplicate/i);
  });

  it('rejects unknown tokens', async () => {
    const res = await validate({
      sheetworkId: VALID_ID,
      fileNameConfig: { tokens: ['consecutivos'] },
    });
    assert.equal(res.ok, false);
    // Joi surfaces the accepted values in the message
    assert.match(res.err.message, /must be one of/i);
  });

  it('rejects an empty tokens array', async () => {
    const res = await validate({
      sheetworkId: VALID_ID,
      fileNameConfig: { tokens: [] },
    });
    assert.equal(res.ok, false);
    assert.match(res.err.message, /at least 1 items/i);
  });

  it('rejects unknown top-level fields', async () => {
    const res = await validate({ sheetworkId: VALID_ID, bogus: 'yes' });
    assert.equal(res.ok, false);
    assert.match(res.err.message, /not allowed/i);
  });
});
