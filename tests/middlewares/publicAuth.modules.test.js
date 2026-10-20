/**
 * modulos-premium-por-tenant, task 2.2: the public ticket portal follows the premium module "QRs y tickets".
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { publicAuth } from '../../src/middlewares/publicAuth.middleware.js';
import { ServiceQr } from '../../src/models/serviceQr.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { serviceQrService } from '../../src/services/serviceQr.service.js';
import { jwtConfig } from '../../src/config/jwt.config.js';

const OID = (n) => `507f1f77bcf86cd7994390${String(n).padStart(2, '0')}`;
const lean = (value) => {
  const q = { select: () => q, setOptions: () => q, lean: () => Promise.resolve(value), then: (res, rej) => Promise.resolve(value).then(res, rej) };
  return q;
};
const sessionToken = () => jwt.sign(
  { serviceQrId: OID(1), tenantId: 't1', ClienteId: OID(2), sedeId: OID(3), servicioId: OID(4) },
  jwtConfig.publicSession.secret,
  { expiresIn: '1h' },
);

const saved = process.env.ENFORCE_TENANT_CAPABILITIES;
let caps;
beforeEach(() => {
  caps = { executesServices: true, registersExternal: false, usesQrs: true };
  Tenant.findOne = () => lean({ tenantId: 't1', capabilities: caps });
  ServiceQr.findOne = () => lean({ _id: OID(1), tenantId: 't1', active: true, isDeleted: false, passwordRotatedAt: new Date(0) });
});
afterEach(() => {
  delete Tenant.findOne;
  delete ServiceQr.findOne;
  if (saved === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
  else process.env.ENFORCE_TENANT_CAPABILITIES = saved;
});

const run = async () => {
  const req = { headers: { authorization: `Bearer ${sessionToken()}` } };
  let err = null;
  await publicAuth(req, {}, (e) => { err = e || null; });
  return { req, err };
};

describe('publicAuth follows the QR module', () => {
  it('a tenant with usesQrs keeps its sessions', async () => {
    const { req, err } = await run();
    assert.equal(err, null);
    assert.equal(req.publicSession.tenantId, 't1');
  });

  it('turning the module off invalidates an already issued session', async () => {
    caps = { executesServices: true, registersExternal: false, usesQrs: false };
    const { err } = await run();
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'SESSION_INVALIDATED');
  });

  it('a legacy tenant without the stored field has the module off', async () => {
    caps = undefined;
    const { err } = await run();
    assert.equal(err.code, 'SESSION_INVALIDATED');
  });

  it('warn and off let the session through', async () => {
    caps = { usesQrs: false };
    for (const mode of ['warn', 'off']) {
      process.env.ENFORCE_TENANT_CAPABILITIES = mode;
      const { err } = await run();
      assert.equal(err, null, mode);
    }
  });
});

describe('serviceQrService.validateAccess follows the QR module', () => {
  let compared;
  beforeEach(() => {
    compared = 0;
    ServiceQr.findOne = () => lean({
      _id: OID(1), tenantId: 't1', active: true, isDeleted: false, ClienteId: OID(2), sedeId: OID(3), servicioId: OID(4),
      comparePassword: async () => { compared += 1; return false; },
    });
  });

  it('a tenant without usesQrs gets the same invalid-credentials error and the password is never checked', async () => {
    caps = { usesQrs: false };
    await assert.rejects(
      () => serviceQrService.validateAccess({ qrToken: 'tok', password: 'x' }),
      (e) => e.statusCode === 401 && e.code === 'INVALID_CREDENTIALS',
    );
    assert.equal(compared, 0);
  });

  it('a tenant with usesQrs goes on to check the password', async () => {
    await assert.rejects(
      () => serviceQrService.validateAccess({ qrToken: 'tok', password: 'x' }),
      (e) => e.code === 'INVALID_CREDENTIALS',
    );
    assert.equal(compared, 1);
  });
});
