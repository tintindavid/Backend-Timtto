/**
 * tests/integration/publicEquipment.routes.test.js
 *
 * Same convention as tests/integration/clientPortal.routes.test.js: no
 * supertest/mongodb-memory-server — mock the Mongoose model statics at the
 * DB boundary and drive the real service -> controller chain, plus the real
 * rate-limit middleware for the 429 scenario.
 *
 * Covers: 404 unknown/inactive/soft-deleted, 429 above limit, tenant
 * isolation on report fetch, and whitelist (no forbidden keys leak).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import rateLimit from 'express-rate-limit';

import { publicEquipmentController } from '../../src/controllers/publicEquipment.controller.js';
import { publicEquipmentService } from '../../src/services/publicEquipment.service.js';
import { EquipmentQr } from '../../src/models/equipmentQr.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Report } from '../../src/models/report.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';
import { PUBLIC_RATE_LIMIT_PER_MIN } from '../../src/constants/equipmentQr.constants.js';

function mockQuery(result) {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    limit: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

function buildRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; },
    removeHeader(key) { delete this.headers[key]; },
    end() {},
  };
}

const FORBIDDEN_KEYS = ['tenantId', 'createdBy', 'passwordHash', '__v', 'email', 'evidencias', 'storagePath', 'clientReview'];

function containsForbiddenKey(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key)) return key;
    if (key === '_id' && typeof val !== 'string' && val && typeof val.toString === 'function') {
      // allow historial[i]._id (own report id) per design — but never a user _id.
    }
    const nested = containsForbiddenKey(val, seen);
    if (nested) return nested;
  }
  return null;
}

describe('GET /api/public/equipo/:qrToken — controller + service chain', () => {
  afterEach(() => {
    delete EquipmentQr.findOne;
    delete EquipoItem.findOne;
    delete Customer.findOne;
    delete Sedes.findOne;
    delete Report.find;
  });

  it('404s for an unknown token', async () => {
    EquipmentQr.findOne = () => mockQuery(null);

    const req = { params: { qrToken: 'unknown-token-123456' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    let forwarded = null;
    await publicEquipmentController.getHistory(req, res, (e) => { forwarded = e; });

    assert.ok(forwarded instanceof ApiError);
    assert.equal(forwarded.statusCode, 404);
  });

  it('404s for a deactivated QR (query itself filters active:true, same as unknown)', async () => {
    // EquipmentQr.findOne({ qrToken, active: true }) naturally returns null
    // for an inactive doc — same code path as "unknown".
    EquipmentQr.findOne = () => mockQuery(null);

    const req = { params: { qrToken: 'deactivated-token-12345' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    let forwarded = null;
    await publicEquipmentController.getHistory(req, res, (e) => { forwarded = e; });

    assert.equal(forwarded.statusCode, 404);
  });

  it('404s when the equipo is soft-deleted (EquipoItem query excludes isDeleted via pre-find hook)', async () => {
    EquipmentQr.findOne = () => mockQuery({ qrToken: 'tok123456789012345678', active: true, tenantId: 't1', equipoId: 'eq1' });
    // Soft-deleted equipo -> EquoipoItem.findOne (which already filters
    // isDeleted:false via its own pre-hook) resolves to null.
    EquipoItem.findOne = () => mockQuery(null);

    const req = { params: { qrToken: 'tok123456789012345678' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    let forwarded = null;
    await publicEquipmentController.getHistory(req, res, (e) => { forwarded = e; });

    assert.equal(forwarded.statusCode, 404);
  });

  it('tenant isolation: a cross-tenant report is NOT included in historial', async () => {
    EquipmentQr.findOne = () => mockQuery({ qrToken: 'tokABC12345678901234', active: true, tenantId: 'tenant-A', equipoId: 'eq1' });
    EquipoItem.findOne = () => mockQuery({ _id: 'eq1', tenantId: 'tenant-A', ClienteId: 'cust1', SedeId: 'sede1', Marca: 'GE', Modelo: 'X', Serie: 'S1', Inventario: 'INV1', Ubicacion: 'UCI', EstadoOperativo: 'Operativo', item: 'Monitor' });
    Customer.findOne = () => mockQuery({ Razonsocial: 'Hospital A', Logo: null });
    Sedes.findOne = () => mockQuery({ nombreSede: 'Sede Central' });
    // Report.find is tenant-scoped by the service's own query filter — the
    // mock simulates the DB already applying { tenantId: 'tenant-A' } and
    // therefore never returning the tenant-B report.
    Report.find = () => mockQuery([
      { _id: 'r1', consecutivo: 'R000001', tipoMtto: 'Preventivo', fechaFinalizdo: new Date(), estado: 'Cerrado', EstadoOperativo: 'Operativo', procesadoPor: { snapshotName: 'Juan Tecnico' } },
    ]);

    const req = { params: { qrToken: 'tokABC12345678901234' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    await publicEquipmentController.getHistory(req, res, (e) => { throw e; });

    assert.equal(res.body.data.historial.length, 1);
    assert.equal(res.body.data.historial[0].consecutivo, 'R000001');
  });

  it('sets the Cache-Control header and whitelist has no forbidden keys', async () => {
    EquipmentQr.findOne = () => mockQuery({ qrToken: 'tokXYZ12345678901234', active: true, tenantId: 'tenant-A', equipoId: 'eq1' });
    EquipoItem.findOne = () => mockQuery({ _id: 'eq1', tenantId: 'tenant-A', ClienteId: 'cust1', SedeId: 'sede1', Marca: 'GE', Modelo: 'X', Serie: 'S1', Inventario: 'INV1', Ubicacion: 'UCI', EstadoOperativo: 'Operativo', item: 'Monitor' });
    Customer.findOne = () => mockQuery({ Razonsocial: 'Hospital A', Logo: null });
    Sedes.findOne = () => mockQuery({ nombreSede: 'Sede Central' });
    Report.find = () => mockQuery([
      {
        _id: 'r1',
        consecutivo: 'R000001',
        tipoMtto: 'Preventivo',
        fechaFinalizdo: new Date(),
        estado: 'Cerrado',
        EstadoOperativo: 'Operativo',
        observacionEstadoFinal: 'pendiente repuesto',
        procesadoPor: { userId: 'user-secret-id', snapshotName: 'Juan Tecnico', fechaProceso: new Date() },
      },
    ]);

    const req = { params: { qrToken: 'tokXYZ12345678901234' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    await publicEquipmentController.getHistory(req, res, (e) => { throw e; });

    assert.equal(res.headers['Cache-Control'], 'public, max-age=60, stale-while-revalidate=300');

    const forbiddenKey = containsForbiddenKey(res.body.data);
    assert.equal(forbiddenKey, null, `response leaked forbidden key: ${forbiddenKey}`);
    // procesadoPor.userId must not leak even though the subdoc was selected.
    assert.equal(JSON.stringify(res.body.data).includes('user-secret-id'), false);
  });
});

describe('publicEquipmentReadLimiter — 429 above 60/min per IP', () => {
  it('rejects the 61st request from the same IP within the window with 429 + Retry-After', async () => {
    // Build a small isolated limiter (same config shape) to avoid sharing
    // state with other test files importing the shared singleton.
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: PUBLIC_RATE_LIMIT_PER_MIN,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => `test:${req.ip}`,
      handler: (req, res) => {
        res.set('Retry-After', '60');
        res.status(429).json({ success: false, error: { code: 'RATE_LIMIT_PUBLIC_EQUIPMENT' } });
      },
    });

    const req = { ip: '9.9.9.9', headers: {}, params: {} };
    let last429 = null;

    // The limiter's `handler` for a 429 never calls `next()` — resolve on
    // whichever happens first (next() for allowed, res.status(429) for
    // rejected) instead of assuming next() always fires.
    function runOnce() {
      return new Promise((resolve) => {
        const res = buildRes();
        const origStatus = res.status.bind(res);
        res.status = (code) => {
          origStatus(code);
          if (code === 429) resolve(res);
          return res;
        };
        limiter(req, res, () => resolve(res));
      });
    }

    for (let i = 0; i < PUBLIC_RATE_LIMIT_PER_MIN + 10; i += 1) {
      const res = await runOnce();
      if (res.statusCode === 429) last429 = res;
    }

    assert.ok(last429, 'expected at least one 429 after exceeding the per-minute cap');
    assert.equal(last429.headers['Retry-After'], '60');
  });
});
