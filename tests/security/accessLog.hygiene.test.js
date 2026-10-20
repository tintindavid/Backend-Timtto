/**
 * tests/security/accessLog.hygiene.test.js
 * token-log-hygiene (scenario "Request logging"): the access log of a request carrying an
 * Authorization header, a reset token query and a portal referrer contains none of them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import morgan from 'morgan';

import { ACCESS_LOG_FORMAT } from '../../src/config/accessLog.config.js';

describe('access log format', () => {
  it('writes no Bearer value, reset token or portal token', async () => {
    const lines = [];
    const app = express();
    app.use(morgan(ACCESS_LOG_FORMAT, { stream: { write: (l) => lines.push(l) } }));
    app.get('/api/v1/auth/validate-reset-token', (_req, res) => res.json({ ok: true }));

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/v1/auth/validate-reset-token?token=RESETSECRET999&tenantId=acme`;
      const res = await fetch(url, {
        headers: {
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.PAYLOADPART.SIGNATUREPART',
          Referer: 'https://app.timtto.com/portal/PORTALTOKEN777',
        },
      });
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      await new Promise((r) => server.close(r));
    }

    const dump = lines.join('');
    assert.ok(dump.includes('/api/v1/auth/validate-reset-token'), 'the request is still logged');
    assert.ok(dump.includes('tenantId=acme'));
    for (const secret of ['Bearer', 'eyJhbGci', 'PAYLOADPART', 'RESETSECRET999', 'PORTALTOKEN777']) {
      assert.ok(!dump.includes(secret), `access log leaks ${secret}`);
    }
  });
});
