/**
 * tests/dtos/tenantCapabilities.dto.test.js
 * tenant-capabilities-hybrid-mode, tasks 6.2 and 6.4 (DTO side).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTenantWithAdminSchema } from '../../src/dtos/createTenantWithAdmin.dto.js';
import { updateTenantCapabilitiesSchema } from '../../src/dtos/updateTenantCapabilities.dto.js';
import { updateTenantMetadataSchema } from '../../src/dtos/updateTenantMetadata.dto.js';

const OID = '507f1f77bcf86cd799439011';
const admin = { email: 'a@b.com', firstName: 'Ana', lastName: 'Perez' };
const fullTenant = {
  tenantId: 'acme', name: 'Acme', nit: '900123456-7', ciudad: 'Bogota', departamento: 'Cundinamarca',
  email: 'info@acme.com', telefono: '6011234567',
};
const validate = (schema, value) => schema.validate(value, { abortEarly: false });

describe('usesQrs (premium module "QRs y tickets")', () => {
  it('the update accepts it alone, with flags or with a preset', () => {
    for (const body of [{ usesQrs: true }, { usesQrs: false, registersExternal: true }, { type: 'client', usesQrs: true }]) {
      assert.equal(validate(updateTenantCapabilitiesSchema, body).error, undefined, JSON.stringify(body));
    }
  });

  it('the update rejects a non boolean and keeps rejecting unknown keys', () => {
    assert.ok(validate(updateTenantCapabilitiesSchema, { usesQrs: 'si' }).error);
    assert.ok(validate(updateTenantCapabilitiesSchema, { premium: true }).error);
  });

  it('the create accepts it inside explicit capabilities', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      tenant: { ...fullTenant }, admin, capabilities: { executesServices: true, registersExternal: false, usesQrs: true },
    });
    assert.equal(error, undefined);
  });
});

describe('createTenantWithAdminSchema capabilities / type', () => {
  it('a provider tenant that manages customers validates with a minimal tenant (no organization data needed)', () => {
    const { error } = validate(createTenantWithAdminSchema, { tenant: { tenantId: 'acme', name: 'Acme' }, admin, capabilities: { managesCustomers: true } });
    assert.equal(error, undefined);
  });

  it('managesCustomers defaults OFF: a minimal tenant now needs the organization data (mantenimiento propio)', () => {
    const { error } = validate(createTenantWithAdminSchema, { tenant: { tenantId: 'acme', name: 'Acme' }, admin });
    assert.ok(error);
    assert.equal(validate(createTenantWithAdminSchema, { tenant: fullTenant, admin }).error, undefined);
  });

  it('managesCustomers without executesServices is rejected', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      tenant: fullTenant, admin, capabilities: { executesServices: false, registersExternal: true, managesCustomers: true },
    });
    assert.ok(error);
  });

  it('the capabilities update accepts managesCustomers alone or with flags', () => {
    for (const body of [{ managesCustomers: true }, { managesCustomers: false, usesQrs: true }, { type: 'hybrid', managesCustomers: true }]) {
      assert.equal(validate(updateTenantCapabilitiesSchema, body).error, undefined, JSON.stringify(body));
    }
    assert.ok(validate(updateTenantCapabilitiesSchema, { managesCustomers: 'si' }).error);
  });

  it('accepts type provider|client|hybrid at the top level', () => {
    for (const type of ['provider', 'client', 'hybrid']) {
      const { error } = validate(createTenantWithAdminSchema, { type, tenant: fullTenant, admin });
      assert.equal(error, undefined, type);
    }
  });

  it('accepts capabilities flags at the top level', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      capabilities: { executesServices: false, registersExternal: true }, tenant: fullTenant, admin,
    });
    assert.equal(error, undefined);
  });

  it('also accepts type / capabilities inside tenant (multipart friendly)', () => {
    assert.equal(validate(createTenantWithAdminSchema, { tenant: { ...fullTenant, type: 'client' }, admin }).error, undefined);
    assert.equal(
      validate(createTenantWithAdminSchema, { tenant: { ...fullTenant, capabilities: { executesServices: true, registersExternal: true } }, admin }).error,
      undefined,
    );
  });

  it('rejects an unknown type and unknown capability keys', () => {
    assert.ok(validate(createTenantWithAdminSchema, { type: 'weird', tenant: fullTenant, admin }).error);
    assert.ok(validate(createTenantWithAdminSchema, { capabilities: { executesServices: true, other: 1 }, tenant: fullTenant, admin }).error);
  });

  it('rejects type and capabilities together (ambiguous)', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      type: 'client', capabilities: { executesServices: false, registersExternal: true }, tenant: fullTenant, admin,
    });
    assert.ok(error);
  });

  it('rejects both flags false', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      capabilities: { executesServices: false, registersExternal: false }, tenant: fullTenant, admin,
    });
    assert.ok(error);
  });

  for (const missing of ['nit', 'ciudad', 'departamento', 'email', 'telefono']) {
    it(`a client tenant without ${missing} is rejected`, () => {
      const tenant = { ...fullTenant };
      delete tenant[missing];
      const { error } = validate(createTenantWithAdminSchema, { type: 'client', tenant, admin });
      assert.ok(error);
      assert.match(error.message, new RegExp(missing));
    });

    it(`a client tenant with an empty ${missing} is rejected`, () => {
      const { error } = validate(createTenantWithAdminSchema, { type: 'client', tenant: { ...fullTenant, [missing]: '' }, admin });
      assert.ok(error);
    });

    it(`a tenant created through flags with executesServices=false also needs ${missing}`, () => {
      const tenant = { ...fullTenant };
      delete tenant[missing];
      const { error } = validate(createTenantWithAdminSchema, {
        capabilities: { executesServices: false, registersExternal: true }, tenant, admin,
      });
      assert.ok(error);
    });
  }

  it('hybrid and provider do not require the organization data when they manage customers', () => {
    for (const type of ['provider', 'hybrid']) {
      const { error } = validate(createTenantWithAdminSchema, { tenant: { tenantId: 'acme', name: 'Acme', capabilities: { ...(type === 'hybrid' ? { executesServices: true, registersExternal: true } : {}), managesCustomers: true } }, admin });
      assert.equal(error, undefined, type);
    }
  });

  it('still rejects unknown top-level keys', () => {
    assert.ok(validate(createTenantWithAdminSchema, { tenant: fullTenant, admin, tenantId: 'x' }).error);
  });
});

describe('updateTenantCapabilitiesSchema', () => {
  it('accepts a preset, flags, or a chosen organization client', () => {
    assert.equal(validate(updateTenantCapabilitiesSchema, { type: 'client' }).error, undefined);
    assert.equal(validate(updateTenantCapabilitiesSchema, { executesServices: false }).error, undefined);
    assert.equal(validate(updateTenantCapabilitiesSchema, { executesServices: false, registersExternal: true }).error, undefined);
    assert.equal(validate(updateTenantCapabilitiesSchema, { type: 'client', organizationCustomerId: OID }).error, undefined);
  });

  it('rejects an empty body, an unknown key, a bad type, a bad id and a non-boolean flag', () => {
    for (const bad of [{}, { type: 'client', foo: 1 }, { type: 'nope' }, { organizationCustomerId: 'xyz' }, { executesServices: 'maybe' }]) {
      assert.ok(validate(updateTenantCapabilitiesSchema, bad).error, JSON.stringify(bad));
    }
  });

  it('rejects type combined with flags', () => {
    assert.ok(validate(updateTenantCapabilitiesSchema, { type: 'client', executesServices: false }).error);
    assert.ok(validate(updateTenantCapabilitiesSchema, { type: 'client', registersExternal: true }).error);
  });

  it('does not accept tenantId or status', () => {
    assert.ok(validate(updateTenantCapabilitiesSchema, { type: 'client', tenantId: 'x' }).error);
    assert.ok(validate(updateTenantCapabilitiesSchema, { type: 'client', status: 'closed' }).error);
  });
});

describe('updateTenantMetadataSchema (PUT /my-tenant) stays closed to capabilities', () => {
  it('rejects capabilities, type and organizationCustomerId', () => {
    assert.ok(validate(updateTenantMetadataSchema, { name: 'x', capabilities: { executesServices: false, registersExternal: true } }).error);
    assert.ok(validate(updateTenantMetadataSchema, { name: 'x', type: 'client' }).error);
    assert.ok(validate(updateTenantMetadataSchema, { name: 'x', organizationCustomerId: OID }).error);
  });
});

describe('scheduleQuickLoad (premium switch "Carga rápida desde el cronograma")', () => {
  it('the update accepts it alone, with flags or with a preset', () => {
    for (const body of [{ scheduleQuickLoad: true }, { scheduleQuickLoad: false, registersExternal: true }, { type: 'hybrid', scheduleQuickLoad: true }]) {
      assert.equal(validate(updateTenantCapabilitiesSchema, body).error, undefined, JSON.stringify(body));
    }
  });

  it('the update rejects a non boolean', () => {
    assert.ok(validate(updateTenantCapabilitiesSchema, { scheduleQuickLoad: 'si' }).error);
  });

  it('the create accepts it inside explicit capabilities', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      tenant: { ...fullTenant }, admin, capabilities: { executesServices: true, registersExternal: true, scheduleQuickLoad: true },
    });
    assert.equal(error, undefined);
  });
});

describe('usesInventoryBasic / usesInventoryAdvanced (inventario-stock)', () => {
  it('the update accepts both flags, alone or together, and rejects non-boolean values', () => {
    for (const body of [{ usesInventoryBasic: true }, { usesInventoryAdvanced: false }, { usesInventoryBasic: true, usesInventoryAdvanced: true }]) {
      assert.equal(validate(updateTenantCapabilitiesSchema, body).error, undefined, JSON.stringify(body));
    }
    assert.ok(validate(updateTenantCapabilitiesSchema, { usesInventoryBasic: 'maybe' }).error);
  });

  it('the tenant creation accepts them inside capabilities', () => {
    const body = { tenant: fullTenant, admin, capabilities: { usesInventoryBasic: true, usesInventoryAdvanced: true } };
    assert.equal(validate(createTenantWithAdminSchema, body).error, undefined);
  });
});

describe('createTenantWithAdminSchema error messages (managesCustomers adversarial #4)', () => {
  const msgs = (e) => (e ? e.details.map((d) => d.message).join(' | ') : '');

  it('provider/hybrid without organization data and without managesCustomers asks for the data unless "Gestiona clientes"', () => {
    for (const body of [{ type: 'provider' }, { type: 'hybrid' }, {}]) {
      const { error } = validate(createTenantWithAdminSchema, { tenant: { tenantId: 'acme', name: 'Acme' }, admin, ...body });
      assert.match(msgs(error), /Gestiona clientes/, JSON.stringify(body));
      assert.doesNotMatch(msgs(error), /no ejecuta servicios/i, JSON.stringify(body));
    }
  });

  it('managesCustomers without executesServices says it requires "Ejecuta servicios", not "at least one capability"', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      tenant: fullTenant, admin, capabilities: { executesServices: false, registersExternal: true, managesCustomers: true },
    });
    assert.match(msgs(error), /ejecutar servicios/i);
    assert.doesNotMatch(msgs(error), /Al menos una capacidad/);
  });

  it('no capability enabled keeps the "at least one capability" reason', () => {
    const { error } = validate(createTenantWithAdminSchema, {
      tenant: fullTenant, admin, capabilities: { executesServices: false, registersExternal: false },
    });
    assert.match(msgs(error), /Al menos una capacidad/);
  });
});
