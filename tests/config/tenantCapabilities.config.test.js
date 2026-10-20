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
} from '../../src/config/tenantCapabilities.config.js';

describe('normalizeCapabilities', () => {
  it('applies the provider defaults when the field is missing', () => {
    for (const missing of [undefined, null, {}, 'x', 5]) {
      assert.deepEqual(normalizeCapabilities(missing), { executesServices: true, registersExternal: false });
    }
  });

  it('keeps stored values and defaults only the missing flag', () => {
    assert.deepEqual(normalizeCapabilities({ executesServices: false }), { executesServices: false, registersExternal: false });
    assert.deepEqual(normalizeCapabilities({ registersExternal: true }), { executesServices: true, registersExternal: true });
    assert.deepEqual(normalizeCapabilities({ executesServices: false, registersExternal: true }), { executesServices: false, registersExternal: true });
  });

  it('coerces to booleans and ignores unknown keys', () => {
    assert.deepEqual(normalizeCapabilities({ executesServices: 0, registersExternal: 1, junk: 1 }), { executesServices: false, registersExternal: true });
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
    assert.deepEqual(resolveCapabilitiesInput({}), { executesServices: true, registersExternal: false });
  });

  it('uses the preset or the flags', () => {
    assert.deepEqual(resolveCapabilitiesInput({ type: 'client' }), { executesServices: false, registersExternal: true });
    assert.deepEqual(
      resolveCapabilitiesInput({ capabilities: { executesServices: false, registersExternal: true } }),
      { executesServices: false, registersExternal: true },
    );
  });

  it('merges partial flags over the CURRENT values when a base is given', () => {
    const base = { executesServices: true, registersExternal: false };
    assert.deepEqual(resolveCapabilitiesInput({ registersExternal: true }, base), { executesServices: true, registersExternal: true });
  });

  it('rejects both flags false', () => {
    assert.throws(
      () => resolveCapabilitiesInput({ capabilities: { executesServices: false, registersExternal: false } }),
      (err) => err.statusCode === 400,
    );
  });
});

describe('route map', () => {
  it('has exactly the prefixes of the spec, all requiring executesServices', () => {
    assert.deepEqual(
      CAPABILITY_ROUTE_MAP.map((e) => e.prefix).sort(),
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
    assert.ok(CAPABILITY_ROUTE_MAP.every((e) => e.capability === 'executesServices'));
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
  const mappedPrefixes = CAPABILITY_ROUTE_MAP.map((e) => e.prefix);

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
    const isMountedOrUnderCommon = (p) => mounted.includes(p) || COMMON_ROUTE_PREFIXES.some((c) => mounted.includes(c) && p.startsWith(`${c}/`));
    for (const p of mappedPrefixes) assert.ok(isMountedOrUnderCommon(p), `${p} is mapped but not mounted`);
    for (const p of COMMON_ROUTE_PREFIXES) assert.ok(mounted.includes(p), `${p} is "common" but not mounted`);
    assert.deepEqual(mappedPrefixes.filter((p) => COMMON_ROUTE_PREFIXES.includes(p)), []);
  });
});

describe('findRequiredCapability: repeated slashes', () => {
  it('collapses them before matching', () => {
    assert.equal(findRequiredCapability('/api/v1//ots'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1/tickets//work-order'), 'executesServices');
    assert.equal(findRequiredCapability('/api//v1///repuestos//ot-from-solicitudes/'), 'executesServices');
    assert.equal(findRequiredCapability('/api/v1//tickets'), null);
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
