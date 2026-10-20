/**
 * tests/security/redactUrl.util.test.js
 * token-log-hygiene: the access log (morgan) must not carry reset tokens, portal/sign/download
 * tokens or any `token`-like query value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { redactSensitiveUrl } from '../../src/utils/redactUrl.util.js';

describe('redactSensitiveUrl', () => {
  it('redacts the reset token query value and keeps the other params', () => {
    const out = redactSensitiveUrl('/api/v1/auth/validate-reset-token?token=abcDEF123456&tenantId=acme');
    assert.equal(out, '/api/v1/auth/validate-reset-token?token=[REDACTED]&tenantId=acme');
    assert.ok(!out.includes('abcDEF123456'));
  });

  it('redacts password/secret/key-like params case-insensitively', () => {
    const out = redactSensitiveUrl('/x?Password=p1&client_secret=s1&apiKey=k1&page=2');
    assert.ok(!/p1|s1|k1/.test(out.replace('page=2', '')));
    assert.ok(out.includes('page=2'));
  });

  it('redacts the opaque token path segment of public token routes', () => {
    for (const prefix of ['/public/client-view/', '/public/sheet-sign/', '/public/sheet-download/', '/api/public/equipo/', '/public/tickets/', '/portal/', '/firma/']) {
      const out = redactSensitiveUrl(`${prefix}SECRETTOKEN123/sheets/5?x=1`);
      assert.ok(!out.includes('SECRETTOKEN123'), prefix);
      assert.ok(out.startsWith(`${prefix}[REDACTED]`), prefix);
    }
  });

  it('leaves ordinary URLs untouched', () => {
    assert.equal(redactSensitiveUrl('/api/v1/ots?page=1&limit=10'), '/api/v1/ots?page=1&limit=10');
  });

  it('handles absolute URLs (referrer) and non-strings', () => {
    assert.equal(redactSensitiveUrl('https://app.timtto.com/portal/TOK123?x=1'), 'https://app.timtto.com/portal/[REDACTED]?x=1');
    assert.equal(redactSensitiveUrl(undefined), undefined);
    assert.equal(redactSensitiveUrl(''), '');
  });
});

describe('redactSensitiveUrl: extra token routes and evasion attempts', () => {
  it('masks the opaque token of /hoja-descarga/', () => {
    const out = redactSensitiveUrl('/hoja-descarga/abcDEF1234567890abcDEF');
    assert.equal(out, '/hoja-descarga/[REDACTED]');
  });

  it('is case-insensitive on the route prefix', () => {
    const out = redactSensitiveUrl('/PORTAL/abcDEF1234567890abcDEF/sheets');
    assert.ok(!out.includes('abcDEF1234567890abcDEF'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('sees through percent-encoded prefixes', () => {
    const out = redactSensitiveUrl('/%66irma/abcDEF1234567890abcDEF');
    assert.ok(!out.includes('abcDEF1234567890abcDEF'));
  });

  it('does not throw on malformed percent-encoding and keeps masking query credentials', () => {
    const out = redactSensitiveUrl('/portal/%E0%A4%A/tok123?token=secretvalue&x=1');
    assert.ok(!out.includes('secretvalue'));
  });
});

describe('redactSensitiveUrl: log forging (CWE-117)', () => {
  it('ordinary URLs are logged exactly as before, even with an encoded line break', () => {
    const url = '/api/v1/customers%0AINJECTED%20FAKE%20LOG%20LINE?page=1';
    assert.equal(redactSensitiveUrl(url), url);
    assert.ok(!/[\r\n]/.test(redactSensitiveUrl(url)));
  });

  it('a decoded token route never returns raw control characters', () => {
    const out = redactSensitiveUrl('/portal/%0D%0AINJECTED/abcDEF1234567890');
    assert.ok(!/[\r\n\u2028\u2029]/.test(out), JSON.stringify(out));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('control characters before the token segment are escaped, not decoded', () => {
    const out = redactSensitiveUrl('/x%0Ay/portal/secretvalue12345');
    assert.ok(!/[\r\n]/.test(out), JSON.stringify(out));
    assert.ok(!out.includes('secretvalue12345'));
  });
});

describe('redactSensitiveUrl: encoded query parameter names', () => {
  it('masks a credential parameter whose name is percent-encoded', () => {
    const out = redactSensitiveUrl('/api/v1/auth/validate-reset-token?%74oken=abcDEF123456&x=1');
    assert.ok(!out.includes('abcDEF123456'), out);
    assert.ok(out.includes('x=1'));
  });
});
