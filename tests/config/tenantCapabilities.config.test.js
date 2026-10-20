/**
 * tests/config/tenantCapabilities.config.test.js
 * tenant-capabilities-hybrid-mode, tasks 2.1 and 2.3.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeCapabilities,
  getTenantType,
  presetToCapabilities,
  assertValidCapabilities,
  resolveCapabilitiesInput,
  CAPABILITY_ROUTE_MAP,
  COMMON_ROUTE_PREFIXES,
  MUTATING_METHODS,
  findRequiredCapability,
  findRequiredCapabilities,
  CAPABILITY_NAMES,
  describeCapabilities,
} from '../../src/config/tenantCapabilities.config.js';

describe('normalizeCapabilities', () => {
  it('applies the provider defaults when the field is missing', () => {
    for (const missing of [undefined, null, {}, 'x', 5]) {
      assert.deepEqual(normalizeCapabilities(missing), { executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false });
    }
  });

  it('keeps stored values and defaults only the missing flag', () => {
    assert.deepEqual(normalizeCapabilities({ executesServices: false }), { executesServices: false, registersExternal: false, usesQrs: false, scheduleQuickLoad: false });
    assert.deepEqual(normalizeCapabilities({ registersExternal: true }), { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: false });
    assert.deepEqual(normalizeCapabilities({ executesServices: false, registersExternal: true }), { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false });
    assert.deepEqual(normalizeCapabilities({ usesQrs: true }), { executesServices: true, registersExternal: false, usesQrs: true, scheduleQuickLoad: false });
  });

  it('coerces to booleans and ignores unknown keys', () => {
    assert.deepEqual(normalizeCapabilities({ executesServices: 0, registersExternal: 1, usesQrs: 1, junk: 1 }), { executesServices: false, registersExternal: true, usesQrs: true, scheduleQuickLoad: false });
  });
});

describe('getTenantType', () => {
  it('derives the three types', () => {
    assert.equal(getTenantType({ executesServices: true, registersExternal: false }), 'provider');
    assert.equal(getTenantType({ executesServices: false, registersExternal: true }), 'client');
    assert.equal(getTenantType({ executesServices: true, registersExternal: true }), 'hybrid');
  });

  it('treats a missing field as provider', () => {
    assert.equal(getTenantType(undefined), 'provider');
  });

  it('rejects both flags false with 400', () => {
    assert.throws(() => getTenantType({ executesServices: false, registersExternal: false }), (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});

describe('assertValidCapabilities', () => {
  it('rejects both flags false with 400 INVALID_CAPABILITIES', () => {
    assert.throws(() => assertValidCapabilities({ executesServices: false, registersExternal: false }), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'INVALID_CAPABILITIES');
      return true;
    });
  });

  it('accepts any other combination', () => {
    assertValidCapabilities({ executesServices: true, registersExternal: false });
    assertValidCapabilities({ executesServices: false, registersExternal: true });
    assertValidCapabilities({ executesServices: true, registersExternal: true });
  });
});

describe('presetToCapabilities', () => {
  it('maps each preset to flags', () => {
    assert.deepEqual(presetToCapabilities('provider'), { executesServices: true, registersExternal: false });
    assert.deepEqual(presetToCapabilities('client'), { executesServices: false, registersExternal: true });
    assert.deepEqual(presetToCapabilities('hybrid'), { executesServices: true, registersExternal: true });
  });

  it('rejects an unknown preset with 400', () => {
    assert.throws(() => presetToCapabilities('weird'), (err) => err.statusCode === 400);
  });
});

describe('resolveCapabilitiesInput', () => {
  it('defaults to provider when nothing is sent', () => {
    assert.deepEqual(resolveCapabilitiesInput({}), { executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false });
  });

  it('uses the preset or the flags', () => {
    assert.deepEqual(resolveCapabilitiesInput({ type: 'client' }), { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false });
    assert.deepEqual(
      resolveCapabilitiesInput({ capabilities: { executesServices: false, registersExternal: true } }),
      { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false },
    );
  });

  it('merges partial flags over the CURRENT values when a base is given', () => {
    const base = { executesServices: true, registersExternal: false };
    assert.deepEqual(resolveCapabilitiesInput({ registersExternal: true }, base), { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: false });
  });

  it('usesQrs is independent: a preset keeps the current value, flags and the preset can set it', () => {
    const base = { executesServices: true, registersExternal: false, usesQrs: true };
    assert.equal(resolveCapabilitiesInput({ type: 'hybrid' }, base).usesQrs, true, 'a preset never turns the module off');
    assert.equal(resolveCapabilitiesInput({ type: 'client', usesQrs: false }, base).usesQrs, false);
    assert.equal(resolveCapabilitiesInput({ usesQrs: true }).usesQrs, true);
    assert.equal(resolveCapabilitiesInput({ type: 'provider' }).usesQrs, false, 'presets never turn a module on');
  });

  it('usesQrs does not count for the rule "at least one capability" nor for the derived type', () => {
    assert.throws(
      () => resolveCapabilitiesInput({ capabilities: { executesServices: false, registersExternal: false, usesQrs: true } }),
      (err) => err.statusCode === 400 && err.code === 'INVALID_CAPABILITIES',
    );
    assert.equal(getTenantType({ executesServices: true, registersExternal: false, usesQrs: true }), 'provider');
  });

  it('rejects both flags false', () => {
    assert.throws(
      () => resolveCapabilitiesInput({ capabilities: { executesServices: false, registersExternal: false } }),
      (err) => err.statusCode === 400,
    );
  });
});

describe('route map', () => {
  it('has exactly the execution-flow prefixes of the spec, all requiring executesServices', () => {
    const execution = CAPABILITY_ROUTE_MAP.filter((e) => e.capability === 'executesServices');
    assert.deepEqual(
      execution.map((e) => e.prefix).sort(),
      [
        '/api/v1/actividad-reporte',
        '/api/v1/client-tokens',
        '/api/v1/ots',
        '/api/v1/reportes',
        '/api/v1/reports',
        '/api/v1/repuestos/ot-from-solicitudes',
        '/api/v1/sheetwork',
        '/api/v1/tickets/work-order',
        '/api/v1/worksheets',
      ],
    );
    assert.ok(execution.every((e) => !e.blockReads), 'execution-flow entries keep reads open');
  });

  it('the premium modules are in the map and block reads', () => {
    const ext = CAPABILITY_ROUTE_MAP.filter((e) => e.capability === 'registersExternal');
    const qrs = CAPABILITY_ROUTE_MAP.filter((e) => e.capability === 'usesQrs');
    assert.deepEqual(ext.filter((e) => e.prefix).map((e) => e.prefix), ['/api/v1/cronogramas/actividades-externas']);
    assert.equal(ext.filter((e) => e.pattern).length, 1);
    assert.deepEqual(qrs.map((e) => e.prefix).sort(), ['/api/v1/equipment-qrs', '/api/v1/service-qrs', '/api/v1/tickets']);
    assert.ok([...ext, ...qrs].every((e) => e.blockReads === true));
  });

  it('findRequiredCapabilities matches parameterized external paths and ignores look-alikes', () => {
    const caps = (p) => findRequiredCapabilities(p).map((e) => e.capability);
    for (const tail of ['actividades-externas', 'actividades-externas/abc', 'cadenas-actividad/abc/cerrar', 'reportes-externos', 'reportes-externos/abc']) {
      assert.deepEqual(caps(`/api/v1/equipos/507f1f77bcf86cd799439011/${tail}`), ['registersExternal'], tail);
    }
    assert.deepEqual(caps('/API/V1/EQUIPOS/abc//Actividades-Externas'), ['registersExternal']);
    assert.deepEqual(caps('/api/v1/equipos/abc/otra-cosa'), []);
    assert.deepEqual(caps('/api/v1/equipos/abc/actividades-externas-x'), []);
    assert.deepEqual(caps('/api/v1/equipos/a/b/actividades-externas'), []);
    assert.deepEqual(caps('/api/v1/cronogramas/actividades-externas'), ['registersExternal']);
    assert.deepEqual(caps('/api/v1/cronogramas'), []);
  });

  it('a path can need several capabilities: tickets/work-order needs executesServices and usesQrs', () => {
    assert.deepEqual(
      findRequiredCapabilities('/api/v1/tickets/work-order').map((e) => e.capability).sort(),
      ['executesServices', 'usesQrs'],
    );
    assert.deepEqual(findRequiredCapabilities('/api/v1/tickets/abc').map((e) => e.capability), ['usesQrs']);
  });

  it('mutating methods are POST PUT PATCH DELETE', () => {
    assert.deepEqual([...MUTATING_METHODS].sort(), ['DELETE', 'PATCH', 'POST', 'PUT']);
  });

  it('findRequiredCapability matches the prefix and sub-paths on a segment boundary, case-insensitively', () => {
    assert.equal(findRequiredCapability('/api/v1/ots'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1/ots/'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1/ots/123/notes'), 'executesServices');
    assert.equal(findRequiredCapability('/API/V1/OTS/123'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1/reportes/9'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1/otsx'), null, 'segment boundary');
    assert.equal(findRequiredCapability('/api/v1/ticketsx'), null, 'segment boundary');
    assert.equal(findRequiredCapability('/api/v1/customers'), null);
    assert.equal(findRequiredCapability('/api/v1/informes/por-ot'), null);
    assert.equal(findRequiredCapability(undefined), null);
  });
});

describe('every router mounted under /api/v1 is classified (spec: Every mounted router is classified)', () => {
  const appSource = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/app.js'),
    'utf8',
  );
  // app.use('/api/v1/xxx', router) -> '/api/v1/xxx' (a ':param' segment ends the prefix)
  const activeSource = appSource
    .split(String.fromCharCode(10))
    .filter((line) => !line.trim().startsWith('//'))
    .join(String.fromCharCode(10));
  const mounted = [...activeSource.matchAll(/app\.use\(\s*'(\/api\/v1\/[^']*)'/g)]
    .map((m) => m[1].split('/:')[0].replace(/\/$/, ''));
  const mappedPrefixes = CAPABILITY_ROUTE_MAP.filter((e) => e.prefix).map((e) => e.prefix);

  it('parses a plausible number of mount points', () => {
    assert.ok(mounted.length > 30, `only ${mounted.length} mount points parsed`);
    assert.ok(mounted.includes('/api/v1/ots'));
  });

  it('each mounted prefix is in the capability map or in the explicit common list', () => {
    const unclassified = [...new Set(mounted)].filter(
      (p) => !mappedPrefixes.includes(p) && !COMMON_ROUTE_PREFIXES.includes(p),
    );
    assert.deepEqual(unclassified, [], `Classify these routers in tenantCapabilities.config.js: ${unclassified.join(', ')}`);
  });

  it('every mapped prefix is mounted (no stale entries) and no prefix is in both lists', () => {
    // An entry is either a mount or one endpoint under a "common" mount (found by the security audit).
    const isMountedOrUnderCommon = (p) => mounted.includes(p) || mounted.some((c) => p.startsWith(`${c}/`));
    for (const p of mappedPrefixes) assert.ok(isMountedOrUnderCommon(p), `${p} is mapped but not mounted`);
    for (const p of COMMON_ROUTE_PREFIXES) assert.ok(mounted.includes(p), `${p} is "common" but not mounted`);
    assert.deepEqual(mappedPrefixes.filter((p) => COMMON_ROUTE_PREFIXES.includes(p)), []);
  });

  it('every router mounted under /api/v1/equipos/:equipoId is known to the pattern entries', () => {
    // The map gates these paths by pattern; a new router under the same prefix would stay open unless it is
    // reviewed here and its paths added to the pattern (or classified as open on purpose). Any ':param' name and
    // extra sub-path are tolerated and the router is the last identifier; a call like `requireX()` before the router
    // makes the test fail loudly (fix the regex then), never silently.
    const nested = [...activeSource.matchAll(/app\.use\(\s*'\/api\/v1\/equipos\/:[^']*'\s*,([^)]*)\)/g)]
      .map((m) => m[1].split(',').map((a) => a.trim()).filter(Boolean).pop())
      .sort();
    assert.deepEqual(
      nested,
      ['actividadExternaRouter', 'reporteExternoRouter'],
      'A new router under /api/v1/equipos/:equipoId must be classified in tenantCapabilities.config.js',
    );
    assert.ok(CAPABILITY_ROUTE_MAP.some((e) => e.pattern), 'the external paths are gated by a pattern entry');
  });
});

describe('findRequiredCapability: repeated slashes', () => {
  it('collapses them before matching', () => {
    assert.equal(findRequiredCapability('/api/v1//ots'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1/tickets//work-order'), 'executesServices');
    assert.equal(findRequiredCapability('/api//v1///repuestos//ot-from-solicitudes/'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1//tickets'), 'usesQrs');
    assert.equal(findRequiredCapability('/api/v1//customers'), null);
  });
});

describe('getEnforcementMode and assertCapability honour ENFORCE_TENANT_CAPABILITIES', () => {
  const saved = process.env.ENFORCE_TENANT_CAPABILITIES;
  const restore = () => {
    if (saved === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
    else process.env.ENFORCE_TENANT_CAPABILITIES = saved;
  };
  const client = { executesServices: false, registersExternal: true };

  it('defaults to on and treats unknown values as on; ignores case and spaces for off/warn', async () => {
    const { getEnforcementMode } = await import('../../src/config/tenantCapabilities.config.js');
    try {
      delete process.env.ENFORCE_TENANT_CAPABILITIES;
      assert.equal(getEnforcementMode(), 'on');
      for (const [value, expected] of [['on', 'on'], ['', 'on'], ['banana', 'on'], ['off', 'off'], [' OFF ', 'off'], ['Warn', 'warn']]) {
        process.env.ENFORCE_TENANT_CAPABILITIES = value;
        assert.equal(getEnforcementMode(), expected, JSON.stringify(value));
      }
    } finally { restore(); }
  });

  it('assertCapability throws in on mode and passes in warn and off (customers rules obey the same switch)', async () => {
    const { assertCapability } = await import('../../src/config/tenantCapabilities.config.js');
    try {
      delete process.env.ENFORCE_TENANT_CAPABILITIES;
      assert.throws(() => assertCapability(client, 'executesServices'), (e) => e.statusCode === 403 && e.code === 'CAPABILITY_DISABLED');
      process.env.ENFORCE_TENANT_CAPABILITIES = 'warn';
      assert.doesNotThrow(() => assertCapability(client, 'executesServices'));
      process.env.ENFORCE_TENANT_CAPABILITIES = 'off';
      assert.doesNotThrow(() => assertCapability(client, 'executesServices'));
    } finally { restore(); }
  });
});

describe('scheduleQuickLoad (cronograma-carga-rapida): premium switch that needs registersExternal', () => {
  const bad = (fn) => assert.throws(fn, (err) => err.statusCode === 400 && err.code === 'INVALID_CAPABILITIES' && err.details.requires === 'registersExternal');

  it('defaults to false and normalizes to the EFFECTIVE value (stored true counts only with registersExternal)', () => {
    assert.equal(normalizeCapabilities(undefined).scheduleQuickLoad, false);
    assert.equal(normalizeCapabilities({ scheduleQuickLoad: true }).scheduleQuickLoad, false, 'inconsistent document reads as off');
    assert.equal(normalizeCapabilities({ registersExternal: true, scheduleQuickLoad: true }).scheduleQuickLoad, true);
    assert.equal(normalizeCapabilities({ registersExternal: true }).scheduleQuickLoad, false);
    assert.equal(normalizeCapabilities({ registersExternal: true, scheduleQuickLoad: 1 }).scheduleQuickLoad, true, 'coerced to boolean');
  });

  it('turning it on needs registersExternal in the requested result', () => {
    bad(() => resolveCapabilitiesInput({ scheduleQuickLoad: true }));
    bad(() => resolveCapabilitiesInput({ capabilities: { executesServices: true, registersExternal: false, scheduleQuickLoad: true } }));
    assert.deepEqual(
      resolveCapabilitiesInput({ registersExternal: true, scheduleQuickLoad: true }),
      { executesServices: true, registersExternal: true, usesQrs: false, scheduleQuickLoad: true },
    );
  });

  it('turning registersExternal off while it is on is rejected; off together is fine', () => {
    const base = { executesServices: true, registersExternal: true, scheduleQuickLoad: true };
    bad(() => resolveCapabilitiesInput({ registersExternal: false }, base));
    assert.equal(resolveCapabilitiesInput({ registersExternal: false, scheduleQuickLoad: false }, base).scheduleQuickLoad, false);
    assert.equal(resolveCapabilitiesInput({ scheduleQuickLoad: false }, base).registersExternal, true);
  });

  it('presets keep the current value: hybrid/client keep it, provider is rejected while it is on', () => {
    const base = { executesServices: true, registersExternal: true, scheduleQuickLoad: true };
    assert.equal(resolveCapabilitiesInput({ type: 'hybrid' }, base).scheduleQuickLoad, true);
    assert.equal(resolveCapabilitiesInput({ type: 'client' }, base).scheduleQuickLoad, true);
    bad(() => resolveCapabilitiesInput({ type: 'provider' }, base));
    assert.equal(resolveCapabilitiesInput({ type: 'provider', scheduleQuickLoad: false }, base).registersExternal, false);
    assert.equal(resolveCapabilitiesInput({ type: 'hybrid' }).scheduleQuickLoad, false, 'a preset never turns it on');
  });

  it('takes no part in the derived type nor in the "at least one capability" rule', () => {
    assert.equal(getTenantType({ executesServices: false, registersExternal: true, scheduleQuickLoad: true }), 'client');
    assert.equal(getTenantType({ executesServices: true, registersExternal: false, scheduleQuickLoad: true }), 'provider');
    assert.throws(
      () => resolveCapabilitiesInput({ capabilities: { executesServices: false, registersExternal: false, scheduleQuickLoad: true } }),
      (err) => err.code === 'INVALID_CAPABILITIES',
    );
  });

  it('is part of the capability names and of the exposure shape', () => {
    assert.ok(CAPABILITY_NAMES.includes('scheduleQuickLoad'));
    assert.equal(describeCapabilities({ registersExternal: true, scheduleQuickLoad: true }).scheduleQuickLoad, true);
    assert.equal(describeCapabilities({}).scheduleQuickLoad, false);
  });
});
