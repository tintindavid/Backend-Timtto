/** Cuentas demo — Tarea 4: exportaciones bloqueadas, comprobadas sobre las rutas reales. DB-free. */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { demoLookup } from '../../src/services/demo/demoContext.service.js';
import informeGenerateRoutes from '../../src/routes/informeGenerate.routes.js';
import cronogramaRoutes from '../../src/routes/cronograma.routes.js';
import customerRoutes from '../../src/routes/customer.routes.js';
import requisicionRoutes from '../../src/routes/requisicion.routes.js';

const original = demoLookup.find;
afterEach(() => { demoLookup.find = original; });

const CASES = [
  [informeGenerateRoutes, 'post', '/generate/pdf', 'informe-general'],
  [informeGenerateRoutes, 'post', '/por-ot/xlsx', 'excel-informe'],
  [cronogramaRoutes, 'post', '/excel', 'excel-cronograma'],
  [customerRoutes, 'get', '/export', 'excel-clientes'],
  [customerRoutes, 'get', '/:id/inventario', 'excel-inventario', { formato: 'excel' }],
  [requisicionRoutes, 'get', '/export/xlsx', 'excel-requisiciones'],
  [requisicionRoutes, 'get', '/:id/export/xlsx', 'excel-requisiciones'],
  [requisicionRoutes, 'get', '/:id/licitacion/comparativo/export', 'excel-requisiciones', { formato: 'xlsx' }],
];

/** Runs the route's demo guard (the middleware tagged `demoFeature`). */
async function runGuard(router, method, path, tenantId, query) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method} ${path}`);
  const guard = layer.route.stack.map((s) => s.handle).find((h) => h.demoFeature);
  assert.ok(guard, `guard missing on ${method} ${path}`);
  const error = await new Promise((resolve) => guard({ tenantId, query: query ?? {} }, {}, resolve));
  return { guard, error };
}

describe('blocked exports', () => {
  for (const [router, method, path, feature, query] of CASES) {
    it(`${method.toUpperCase()} ${path} is blocked for demos only`, async () => {
      demoLookup.find = async (t) => (t === 'demo1' ? { demo: { enabled: true, limits: {} } } : null);
      const demo = await runGuard(router, method, path, 'demo1', query);
      assert.equal(demo.guard.demoFeature, feature);
      assert.equal(demo.error?.code, 'DEMO_FEATURE_BLOCKED');
      assert.equal((await runGuard(router, method, path, 'acme', query)).error, undefined);
    });
  }

  it('PDF variants of the same routes stay available', async () => {
    demoLookup.find = async () => ({ demo: { enabled: true, limits: {} } });
    assert.equal((await runGuard(customerRoutes, 'get', '/:id/inventario', 'demo1', { formato: 'pdf' })).error, undefined);
    assert.equal((await runGuard(requisicionRoutes, 'get', '/:id/licitacion/comparativo/export', 'demo1', { formato: 'pdf' })).error, undefined);
  });
});
