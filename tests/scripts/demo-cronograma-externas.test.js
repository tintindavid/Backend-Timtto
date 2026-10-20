/**
 * tests/scripts/demo-cronograma-externas.test.js
 * cronograma-actividades-externas, task 13. Pure plan builder of the demo seed script; no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoPlan, PLAN, DEMO_MARKER } from '../../scripts/2026-10-20-demo-cronograma-externas.js';
import { calcularVencimiento } from '../../src/utils/cronogramaMeses.util.js';

const NOW = new Date('2026-10-20T15:00:00Z');
const base = (n) => ({
  tenantId: 'bmlab', clienteId: 'cli', equipoIds: Array.from({ length: n }, (_, i) => `eq${i}`), adminUserId: 'u1', now: NOW,
  providerIds: { a: 'provA', b: 'provB' },
});

describe('buildDemoPlan', () => {
  it('builds one chain with a vigente activity per planned item, tied to the tenant', () => {
    const rows = buildDemoPlan(base(5));
    assert.equal(rows.length, PLAN.length);
    for (const r of rows) {
      assert.equal(r.chain.tenantId, 'bmlab');
      assert.equal(r.activity.tenantId, 'bmlab');
      assert.equal(r.chain.estado, 'vigente');
      assert.equal(r.chain.esUnica, false);
    }
  });

  it('has overdue, due-soon and later items', () => {
    const rows = buildDemoPlan(base(5));
    const v = rows.map((r) => calcularVencimiento(r.chain.fechaProxima, NOW));
    assert.equal(v.filter((x) => x.vencida).length, 2);
    assert.equal(v.filter((x) => !x.vencida && x.diasParaVencer <= 30).length, 1);
    assert.ok(v.some((x) => x.diasParaVencer > 90));
  });

  it('the activity date is in the past and one frequency before the due date', () => {
    const [r] = buildDemoPlan(base(1));
    assert.ok(r.activity.fecha.getTime() <= NOW.getTime());
    const back = new Date(r.chain.fechaProxima.getTime());
    back.setUTCMonth(back.getUTCMonth() - r.chain.frecuenciaMeses);
    assert.equal(back.toISOString(), r.activity.fecha.toISOString());
  });

  it('links providers by id and keeps the free-text one unlinked', () => {
    const rows = buildDemoPlan(base(5));
    assert.equal(rows[0].activity.proveedorId, 'provA');
    assert.equal(rows[0].activity.proveedor, 'Metrologia Andina SAS');
    const libre = rows[4].activity;
    assert.equal(libre.proveedorId, null);
    assert.equal(libre.proveedor, 'Laboratorio Externo (sin registrar)');
  });

  it('attaches each chain to the client that owns its equipment', () => {
    const rows = buildDemoPlan({ ...base(3), clienteIds: ['cliA', 'cliB', undefined] });
    assert.deepEqual(rows.map((r) => r.chain.clienteId), ['cliA', 'cliB', 'cli']);
    assert.deepEqual(rows.map((r) => r.activity.clienteId), ['cliA', 'cliB', 'cli']);
  });

  it('plans only as many items as there are equipment', () => {
    assert.equal(buildDemoPlan(base(2)).length, 2);
  });

  it('exports a marker that identifies the seeded documents', () => {
    assert.equal(DEMO_MARKER, 'cronograma-actividades-externas');
  });
});
