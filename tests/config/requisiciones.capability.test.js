/**
 * requisiciones-e1-base-aprobacion, tasks 1.1 - 1.4 and 1.6: usesRequisiciones capability, route map, permissions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_CAPABILITIES_ENABLED,
  CAPABILITY_NAMES,
  CAPABILITY_ROUTE_MAP,
  COMMON_ROUTE_PREFIXES,
  DEFAULT_CAPABILITIES,
  describeCapabilities,
  findRequiredCapabilities,
  normalizeCapabilities,
  resolveCapabilitiesInput,
} from '../../src/config/tenantCapabilities.config.js';
import { PERMISSIONS, PERMISSION_VALUES, PERMISSIONS_BY_RESOURCE } from '../../src/constants/permissions.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { updateTenantCapabilitiesSchema } from '../../src/dtos/updateTenantCapabilities.dto.js';
import { createTenantWithAdminSchema } from '../../src/dtos/createTenantWithAdmin.dto.js';

const PREFIXES = ['requisiciones', 'areas', 'reglas-aprobacion', 'presupuestos-area', 'tipos-requisicion'].map((p) => `/api/v1/${p}`);

describe('usesRequisiciones capability', () => {
  it('is off by default, on in ALL_CAPABILITIES_ENABLED and listed in CAPABILITY_NAMES', () => {
    assert.equal(DEFAULT_CAPABILITIES.usesRequisiciones, false);
    assert.equal(ALL_CAPABILITIES_ENABLED.usesRequisiciones, true);
    assert.ok(CAPABILITY_NAMES.includes('usesRequisiciones'));
  });

  it('a tenant without the stored field reads as false (scenario: Tenant antiguo sin el campo)', () => {
    assert.equal(normalizeCapabilities(undefined).usesRequisiciones, false);
    assert.equal(normalizeCapabilities({ executesServices: true }).usesRequisiciones, false);
    assert.equal(normalizeCapabilities({ usesRequisiciones: true }).usesRequisiciones, true);
  });

  it('has no dependency: it can be on with every other premium module off, and vice versa', () => {
    const only = resolveCapabilitiesInput({ usesRequisiciones: true });
    assert.equal(only.usesRequisiciones, true);
    assert.equal(only.usesInventoryBasic, false);
    assert.equal(only.registersExternal, false);
    const withoutIt = resolveCapabilitiesInput({ usesInventoryBasic: true, usesInventoryAdvanced: true });
    assert.equal(withoutIt.usesRequisiciones, false);
  });

  it('is kept by a preset (presets never turn a module on or off) and by a partial update', () => {
    const base = { executesServices: true, registersExternal: false, usesRequisiciones: true };
    assert.equal(resolveCapabilitiesInput({ type: 'hybrid' }, base).usesRequisiciones, true);
    assert.equal(resolveCapabilitiesInput({ usesQrs: true }, base).usesRequisiciones, true);
    assert.equal(resolveCapabilitiesInput({ usesRequisiciones: false }, base).usesRequisiciones, false);
    assert.equal(resolveCapabilitiesInput({ type: 'provider' }).usesRequisiciones, false, 'a preset never turns it on');
  });

  it('is exposed by describeCapabilities', () => {
    assert.equal(describeCapabilities({ usesRequisiciones: true }).usesRequisiciones, true);
    assert.equal(describeCapabilities({}).usesRequisiciones, false);
  });

  it('the tenant schema stores it with default false', () => {
    const t = new Tenant({ tenantId: 'acme', name: 'Acme' });
    assert.equal(t.capabilities.usesRequisiciones, false);
    assert.equal(new Tenant({ tenantId: 'acme', name: 'Acme', capabilities: { usesRequisiciones: true } }).validateSync(), undefined);
  });

  it('the superadmin DTOs accept it (and only booleans)', () => {
    assert.equal(updateTenantCapabilitiesSchema.validate({ usesRequisiciones: true }).error, undefined);
    assert.ok(updateTenantCapabilitiesSchema.validate({ usesRequisiciones: 'si' }).error);
    const body = {
      tenant: { tenantId: 'acme', name: 'Acme', email: 'a@acme.co' },
      admin: { firstName: 'A', lastName: 'B', email: 'admin@acme.co' },
      capabilities: { usesRequisiciones: true },
    };
    const { error } = createTenantWithAdminSchema.validate(body);
    const onlyCapsIssue = (error?.details || []).some((d) => d.path.includes('usesRequisiciones'));
    assert.equal(onlyCapsIssue, false, 'usesRequisiciones is a known capability key');
  });
});

describe('route map for the Requisiciones module (scenario: Cobertura de rutas)', () => {
  it('every router of the module is mapped to usesRequisiciones with blockReads', () => {
    for (const prefix of PREFIXES) {
      for (const sub of ['', '/abc', '/abc/def']) {
        assert.deepEqual(
          findRequiredCapabilities(`${prefix}${sub}`),
          [{ capability: 'usesRequisiciones', blockReads: true }],
          `${prefix}${sub}`,
        );
      }
      assert.ok(!COMMON_ROUTE_PREFIXES.includes(prefix), `${prefix} must not be "common"`);
    }
  });

  it('matches on a segment boundary and ignores case and repeated slashes', () => {
    assert.deepEqual(findRequiredCapabilities('/api/v1/areasx'), []);
    assert.deepEqual(findRequiredCapabilities('/API/V1//Requisiciones'), [{ capability: 'usesRequisiciones', blockReads: true }]);
  });

  it('every mapped Requisiciones prefix is mounted in app.js', () => {
    const appSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/app.js'), 'utf8');
    for (const prefix of PREFIXES) {
      assert.ok(appSource.includes(`'${prefix}'`), `${prefix} not mounted`);
      assert.ok(CAPABILITY_ROUTE_MAP.some((e) => e.prefix === prefix));
    }
  });
});

describe('Requisiciones permission catalog', () => {
  const EXPECTED = {
    requisiciones: ['read', 'create', 'update', 'delete', 'send', 'approve', 'cancel', 'manage-all', 'receive'],
    areas: ['read', 'create', 'update', 'delete'],
    'approval-rules': ['read', 'create', 'update', 'delete'],
    budgets: ['read', 'create', 'update', 'delete'],
    'request-types': ['read', 'create', 'update', 'delete'],
  };

  it('exposes requisiciones:*, areas:*, approval-rules:*, budgets:* and request-types:* grouped by resource', () => {
    for (const [resource, actions] of Object.entries(EXPECTED)) {
      for (const action of actions) {
        assert.ok(PERMISSION_VALUES.includes(`${resource}:${action}`), `${resource}:${action} missing`);
      }
      assert.deepEqual([...PERMISSIONS_BY_RESOURCE[resource]].sort(), actions.map((a) => `${resource}:${a}`).sort());
    }
  });

  it('constants map to the resource:action strings and there are no duplicates', () => {
    assert.equal(PERMISSIONS.REQUISICIONES_APPROVE, 'requisiciones:approve');
    assert.equal(PERMISSIONS.APPROVAL_RULES_UPDATE, 'approval-rules:update');
    assert.equal(PERMISSIONS.REQUEST_TYPES_DELETE, 'request-types:delete');
    assert.equal(new Set(PERMISSION_VALUES).size, PERMISSION_VALUES.length);
  });
});
