/**
 * inventario-stock: the global guard blocks the inventory routes (reads included) per capability.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { enforceTenantCapabilities } from '../../src/middlewares/enforceTenantCapabilities.middleware.js';

const saved = process.env.ENFORCE_TENANT_CAPABILITIES;
afterEach(() => {
  if (saved === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
  else process.env.ENFORCE_TENANT_CAPABILITIES = saved;
});

function run({ method = 'GET', path, role = 'admin', capabilities }) {
  delete process.env.ENFORCE_TENANT_CAPABILITIES;
  let err;
  enforceTenantCapabilities({ user: { userId: 'u', role }, method, path, tenant: { tenantId: 't', capabilities } }, {}, (e) => { err = e; });
  return err;
}

describe('enforceTenantCapabilities on inventory routes', () => {
  it('GET /inventario-repuestos is 403 CAPABILITY_DISABLED without usesInventoryBasic', () => {
    const err = run({ path: '/api/v1/inventario-repuestos', capabilities: { executesServices: true } });
    assert.equal(err?.statusCode, 403);
    assert.equal(err.code, 'CAPABILITY_DISABLED');
    assert.equal(err.details.capability, 'usesInventoryBasic');
  });

  it('basic opens the catalogue but not the movements', () => {
    const caps = { executesServices: true, usesInventoryBasic: true };
    assert.equal(run({ path: '/api/v1/inventario-repuestos', capabilities: caps }), undefined);
    const err = run({ path: '/api/v1/inventario-movimientos', capabilities: caps });
    assert.equal(err?.code, 'CAPABILITY_DISABLED');
    assert.equal(err.details.capability, 'usesInventoryAdvanced');
  });

  it('advanced (with basic) opens both; POST movements is gated too', () => {
    const caps = { executesServices: true, usesInventoryBasic: true, usesInventoryAdvanced: true };
    assert.equal(run({ path: '/api/v1/inventario-movimientos', capabilities: caps }), undefined);
    assert.equal(run({ method: 'POST', path: '/api/v1/inventario-movimientos', capabilities: caps }), undefined);
    assert.equal(run({ method: 'POST', path: '/api/v1/inventario-movimientos', capabilities: { executesServices: true, usesInventoryAdvanced: true } })?.statusCode, 403);
  });

  it('superadmin is not blocked', () => {
    assert.equal(run({ path: '/api/v1/inventario-repuestos', role: 'superadmin', capabilities: { executesServices: true } }), undefined);
  });
});
