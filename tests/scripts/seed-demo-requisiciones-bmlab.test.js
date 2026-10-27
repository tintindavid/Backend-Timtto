/**
 * Demo seed of the Requisiciones module (tenant bmlab). DB-free: only the pure parts (argument parsing, safety guards,
 * idempotent planning, dry-run orchestration with fake deps, consistency of the demo spec).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs, assertSafeEnvironment, isLocalMongoUri, resolveMode, generatePassword, planDemo, summarizePlan, runDemo,
  DEMO_REQUISICIONES, DEMO_REGLAS, DEMO_AREAS, DEMO_USERS, DEMO_ROLES, DEMO_PRESUPUESTOS, DEMO_TAG, DEMO_ESTADOS_ESPERADOS,
} from '../../scripts/seed-demo-requisiciones-bmlab.js';
import { findReglaConflicts } from '../../src/services/reglaAprobacion.service.js';
import { PERMISSION_VALUES } from '../../src/constants/permissions.js';

const PERIODOS = { periodoMes: '2026-10', periodoAnio: '2026' };

describe('parseArgs / resolveMode', () => {
  it('defaults to tenant bmlab with nothing enabled', () => {
    assert.deepEqual(parseArgs([]), { dryRun: false, confirm: false, reset: false, forceRemote: false, tenant: 'bmlab' });
  });
  it('parses the flags and the tenant', () => {
    const o = parseArgs(['--dry-run', '--confirm', '--reset', '--tenant=Otro', '--force-remote']);
    assert.deepEqual(o, { dryRun: true, confirm: true, reset: true, forceRemote: true, tenant: 'otro' });
  });
  it('rejects unknown flags and an empty tenant', () => {
    assert.throws(() => parseArgs(['--confrim']), /desconocido/);
    assert.throws(() => parseArgs(['--tenant=']), /--tenant/);
  });
  it('a real write needs --confirm; --dry-run never does', () => {
    assert.throws(() => resolveMode(parseArgs([])), /--confirm/);
    assert.throws(() => resolveMode(parseArgs(['--reset'])), /--confirm/);
    assert.equal(resolveMode(parseArgs(['--dry-run'])), 'seed-dry');
    assert.equal(resolveMode(parseArgs(['--confirm'])), 'seed');
    assert.equal(resolveMode(parseArgs(['--reset', '--dry-run'])), 'reset-dry');
    assert.equal(resolveMode(parseArgs(['--reset', '--confirm'])), 'reset');
  });
});

describe('safety guards', () => {
  const local = 'mongodb://localhost:27017/timtto';
  it('accepts local development databases', () => {
    assert.doesNotThrow(() => assertSafeEnvironment({ nodeEnv: 'development', mongoUri: local }));
    assert.doesNotThrow(() => assertSafeEnvironment({ nodeEnv: undefined, mongoUri: 'mongodb://user:p%40ss@127.0.0.1:27017/x?a=b' }));
  });
  it('refuses production even for a local URI and even with --force-remote', () => {
    assert.throws(() => assertSafeEnvironment({ nodeEnv: 'production', mongoUri: local }), /production/);
    assert.throws(() => assertSafeEnvironment({ nodeEnv: 'Production', mongoUri: local, forceRemote: true }), /production/);
  });
  it('refuses remote / Atlas / look-alike hosts unless --force-remote', () => {
    for (const uri of [
      'mongodb+srv://u:p@cluster0.abcde.mongodb.net/timtto',
      'mongodb://u:p@prod.example.com:27017/timtto',
      'mongodb://localhost.evil.com:27017/timtto',
      'mongodb://localhost:27017,remote.example.com:27017/timtto',
      '', undefined,
    ]) {
      assert.equal(isLocalMongoUri(uri), false, String(uri));
      assert.throws(() => assertSafeEnvironment({ nodeEnv: 'development', mongoUri: uri }), /localhost/);
    }
    assert.doesNotThrow(() => assertSafeEnvironment({ nodeEnv: 'development', mongoUri: 'mongodb://prod.example.com/x', forceRemote: true }));
  });
  it('generates a strong random password each time', () => {
    const a = generatePassword();
    const b = generatePassword();
    assert.notEqual(a, b);
    assert.match(a, /[A-Z]/); assert.match(a, /[a-z]/); assert.match(a, /\d/); assert.match(a, /[^A-Za-z0-9]/);
    assert.ok(a.length >= 20);
  });
});

describe('idempotent planning', () => {
  const full = () => ({
    users: new Set(DEMO_USERS.map((u) => u.email)),
    roles: new Set(DEMO_ROLES.map((r) => r.name)),
    areas: new Set(DEMO_AREAS.map((a) => a.codigo)),
    reglas: new Set(DEMO_REGLAS.map((r) => String(r.orden))),
    presupuestos: new Set(DEMO_PRESUPUESTOS.flatMap((p) => [`${p.areaCodigo}|2026-10`, `${p.areaCodigo}|2026`])),
    requisiciones: new Set(DEMO_REQUISICIONES.map((r) => r.titulo)),
  });

  it('plans everything on an empty tenant', () => {
    const plan = planDemo({}, PERIODOS);
    assert.equal(plan.existing, 0);
    const s = summarizePlan(plan);
    assert.equal(s.users.create, 2);
    assert.equal(s.roles.create, 2);
    assert.equal(s.areas.create, 4);
    assert.equal(s.reglas.create, 3);
    assert.equal(s.presupuestos.create, 8);
    assert.equal(s.requisiciones.create, DEMO_REQUISICIONES.length);
  });
  it('plans nothing when everything exists (second run = 0 new records)', () => {
    const plan = planDemo(full(), PERIODOS);
    assert.equal(plan.toCreate, 0);
  });
  it('plans only what is missing', () => {
    const snap = full();
    snap.requisiciones.delete(DEMO_REQUISICIONES[0].titulo);
    snap.presupuestos.delete('DEMO-LAB|2026');
    const plan = planDemo(snap, PERIODOS);
    assert.equal(plan.toCreate, 2);
  });
});

describe('runDemo orchestration', () => {
  const makeDeps = (snapshot = {}) => {
    const calls = { apply: 0, reset: [], read: 0 };
    return {
      calls,
      periodos: () => PERIODOS,
      readSnapshot: async () => { calls.read += 1; return snapshot; },
      apply: async () => { calls.apply += 1; return { created: 1 }; },
      reset: async (_t, o) => { calls.reset.push(o); return { dryRun: o.dryRun }; },
    };
  };
  it('dry-run reads and plans but writes nothing', async () => {
    const deps = makeDeps();
    const out = await runDemo({ deps, tenantId: 'bmlab', mode: 'seed-dry' });
    assert.equal(deps.calls.apply, 0);
    assert.equal(out.result, null);
    assert.ok(out.plan.toCreate > 0);
  });
  it('a real run applies only when there is something to create', async () => {
    const deps = makeDeps();
    await runDemo({ deps, tenantId: 'bmlab', mode: 'seed' });
    assert.equal(deps.calls.apply, 1);

    const snap = {
      users: new Set(DEMO_USERS.map((u) => u.email)), roles: new Set(DEMO_ROLES.map((r) => r.name)),
      areas: new Set(DEMO_AREAS.map((a) => a.codigo)), reglas: new Set(DEMO_REGLAS.map((r) => String(r.orden))),
      presupuestos: new Set(DEMO_PRESUPUESTOS.flatMap((p) => [`${p.areaCodigo}|2026-10`, `${p.areaCodigo}|2026`])),
      requisiciones: new Set(DEMO_REQUISICIONES.map((r) => r.titulo)),
    };
    const again = makeDeps(snap);
    const out = await runDemo({ deps: again, tenantId: 'bmlab', mode: 'seed' });
    assert.equal(again.calls.apply, 0);
    assert.deepEqual(out.result, { created: 0, noop: true });
  });
  it('reset-dry only asks the dependency for a dry run; reset forwards dryRun=false', async () => {
    const deps = makeDeps();
    await runDemo({ deps, tenantId: 'bmlab', mode: 'reset-dry' });
    await runDemo({ deps, tenantId: 'bmlab', mode: 'reset' });
    assert.deepEqual(deps.calls.reset, [{ dryRun: true }, { dryRun: false }]);
    assert.equal(deps.calls.read, 0);
  });
});

describe('demo spec consistency', () => {
  it('requisitions are tagged, unique and cover the required states', () => {
    const titles = DEMO_REQUISICIONES.map((r) => r.titulo);
    assert.equal(new Set(titles).size, titles.length);
    assert.ok(titles.every((t) => t.startsWith(DEMO_TAG)));
    assert.equal(DEMO_ESTADOS_ESPERADOS.length, DEMO_REQUISICIONES.length);
    for (const e of ['Borrador', 'En_Aprobacion', 'Aprobada', 'Rechazada', 'Cancelada']) assert.ok(DEMO_ESTADOS_ESPERADOS.includes(e), e);
    assert.ok(DEMO_REQUISICIONES.some((r) => r.flow.some((s) => s.op === 'reopen')));
    assert.ok(DEMO_REQUISICIONES.some((r) => r.lineas.some((l) => l.inventario)));
  });
  it('approval rules are consistent (no overlaps, increasing order) and approvers are never the demo creators of a level', () => {
    const rules = DEMO_REGLAS.map((r, i) => ({ ...r, _id: String(i) }));
    for (const r of rules) assert.deepEqual(findReglaConflicts(r, rules.filter((o) => o !== r)), []);
  });
  it('demo roles never carry manage-all and only use real permissions', () => {
    for (const role of DEMO_ROLES) {
      assert.ok(!role.permissions.includes('requisiciones:manage-all'));
      assert.ok(role.permissions.includes('requisiciones:approve'));
      for (const p of role.permissions) assert.ok(PERMISSION_VALUES.includes(p), p);
    }
  });
  it('demo user emails use the .demo domain and areas/budgets point to existing codes', () => {
    assert.ok(DEMO_USERS.every((u) => u.email.endsWith('@bmlab.example.com')));
    const codes = new Set(DEMO_AREAS.map((a) => a.codigo));
    assert.ok(DEMO_AREAS.every((a) => a.codigo.startsWith('DEMO-')));
    assert.ok(DEMO_PRESUPUESTOS.every((p) => codes.has(p.areaCodigo)));
    assert.ok(DEMO_REQUISICIONES.every((r) => codes.has(r.area)));
  });
});
