/**
 * tests/security/app.middleware-order.static.test.js
 * The other chain tests rebuild the middleware chain by hand, so reordering or removing a guard in the
 * real src/app.js would keep them green. This test reads app.js itself and pins the order that the
 * specs depend on (tenant-token-binding, tenant-capabilities, token-log-hygiene).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '../../src/app.js'), 'utf8');

const at = (re) => {
  const m = re.exec(source);
  assert.ok(m, `app.js has no match for ${re}`);
  return m.index;
};

describe('src/app.js middleware order', () => {
  it('resolves the tenant in order: tryAuthenticate, enforceTenantTokenMatch, tenantResolver', () => {
    const a = at(/app\.use\(tryAuthenticate\)/);
    const b = at(/app\.use\(enforceTenantTokenMatch\)/);
    const c = at(/app\.use\(tenantResolver\)/);
    assert.ok(a < b && b < c);
  });

  it('global guards run after the platform and auth routers and before every domain router, in order', () => {
    const platform = at(/app\.use\('\/api\/v1\/platform\/tenants'/);
    const auth = at(/app\.use\('\/api\/v1\/auth'/);
    const mustChange = at(/app\.use\(enforceMustChangePassword\)/);
    const readOnly = at(/app\.use\(enforceReadOnlyForSuperadmin\)/);
    const capabilities = at(/app\.use\(enforceTenantCapabilities\)/);
    assert.ok(platform < mustChange && auth < mustChange);
    assert.ok(mustChange < readOnly && readOnly < capabilities);

    const domainMounts = [...source.matchAll(/app\.use\('\/api\/v1\/([^']+)'/g)]
      .filter((m) => !m[1].startsWith('platform/') && m[1] !== 'auth');
    assert.ok(domainMounts.length > 10, 'expected the domain mounts to be found');
    for (const m of domainMounts) {
      assert.ok(m.index > capabilities, `/api/v1/${m[1]} is mounted before enforceTenantCapabilities`);
    }
  });

  it('the capabilities endpoint is behind the must-change-password guard (428 until the password is changed)', () => {
    const mustChange = at(/app\.use\(enforceMustChangePassword\)/);
    const myTenant = at(/app\.use\('\/api\/v1\/my-tenant'/);
    assert.ok(mustChange < myTenant);
  });

  it('the access log goes through the redactor and never uses the raw combined preset', () => {
    assert.match(source, /morgan\(ACCESS_LOG_FORMAT/);
    assert.doesNotMatch(source, /morgan\(\s*['"]combined['"]/);
    assert.match(source, /from '\.\/config\/accessLog\.config\.js'/);
  });

  it('every middleware named in the specs is registered exactly once', () => {
    for (const name of ['tryAuthenticate', 'enforceTenantTokenMatch', 'tenantResolver', 'enforceMustChangePassword', 'enforceReadOnlyForSuperadmin', 'enforceTenantCapabilities']) {
      const uses = source.match(new RegExp(`app\\.use\\(${name}\\)`, 'g')) || [];
      assert.equal(uses.length, 1, `${name} must be registered exactly once`);
    }
  });
});
