/** requisiciones-datos-por-defecto-tenant, 4.4: --tenant parsing of the seed script. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTenantArg } from '../../scripts/2026-10-25-seed-requisiciones-defaults.js';

describe('parseTenantArg', () => {
  it('returns null when the flag is absent (all tenants with the module)', () => {
    assert.equal(parseTenantArg(['node', 'script', '--dry-run']), null);
  });

  it('returns the tenant id', () => {
    assert.equal(parseTenantArg(['node', 'script', '--tenant=acme', '--dry-run']), 'acme');
  });

  it('fails on a malformed flag instead of falling back to every tenant', () => {
    for (const bad of ['--tenant', '--tenant=', '--tenant=  ']) {
      assert.throws(() => parseTenantArg(['node', 'script', bad]), /--tenant requiere un valor/);
    }
  });
});
