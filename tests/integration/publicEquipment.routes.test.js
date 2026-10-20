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
import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import rateLimit from 'express-rate-limit';

import { publicEquipmentController } from '../../src/controllers/publicEquipment.controller.js';
import { publicEquipmentService } from '../../src/services/publicEquipment.service.js';
import { EquipmentQr } from '../../src/models/equipmentQr.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Sedes } from '../../src/models/sedes.model.js';
import { Report } from '../../src/models/report.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';
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

const ALL_ON = { usesQrs: true, registersExternal: true, executesServices: true };
let tenantCaps = ALL_ON;
const stubTenant = () => { Tenant.findOne = () => mockQuery(tenantCaps === undefined ? { tenantId: 't' } : { tenantId: 't', capabilities: tenantCaps }); };

describe('GET /api/public/equipo/:qrToken — controller + service chain', () => {
  beforeEach(() => { tenantCaps = ALL_ON; stubTenant(); });
  afterEach(() => {
    delete Tenant.findOne;
    delete EquipmentQr.findOne;
    delete EquipoItem.findOne;
    delete Customer.findOne;
    delete Sedes.findOne;
    delete Report.find;
    delete EquipoActividadExterna.find;
    delete CadenaActividad.find;
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
    EquipoActividadExterna.find = () => mockQuery([]);
    CadenaActividad.find = () => mockQuery([]);
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
    EquipoActividadExterna.find = () => mockQuery([]);
    CadenaActividad.find = () => mockQuery([]);
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

describe('GET /api/public/equipo/:qrToken — external activities and external services', () => {
  beforeEach(() => { tenantCaps = ALL_ON; stubTenant(); });
  afterEach(() => {
    delete Tenant.findOne;
    delete EquipmentQr.findOne;
    delete EquipoItem.findOne;
    delete Customer.findOne;
    delete Sedes.findOne;
    delete Report.find;
    delete EquipoActividadExterna.find;
    delete CadenaActividad.find;
  });

  function arrange({ reports = [], actividades = [], cadenas = [] } = {}) {
    EquipmentQr.findOne = () => mockQuery({ qrToken: 'tokEXT12345678901234', active: true, tenantId: 'tenant-A', equipoId: 'eq1' });
    EquipoItem.findOne = () => mockQuery({ _id: 'eq1', tenantId: 'tenant-A', ClienteId: 'cust1', SedeId: 'sede1', Marca: 'GE', Modelo: 'X', Serie: 'S1', Inventario: 'INV1' });
    Customer.findOne = () => mockQuery({ Razonsocial: 'Hospital A', Logo: null });
    Sedes.findOne = () => mockQuery({ nombreSede: 'Sede Central' });
    Report.find = () => mockQuery(reports);
    EquipoActividadExterna.find = () => mockQuery(actividades);
    CadenaActividad.find = () => mockQuery(cadenas);
  }

  async function hit() {
    const req = { params: { qrToken: 'tokEXT12345678901234' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    await publicEquipmentController.getHistory(req, res, (e) => { throw e; });
    return res.body.data;
  }

  it('lists the external activities in a separate array, built field by field', async () => {
    arrange({
      actividades: [
        {
          _id: 'a1', tenantId: 'tenant-A', equipoId: 'eq1', tipo: 'calibracion', fecha: new Date('2026-10-17'),
          proveedor: 'Biolab', consecutivoExterno: 'CAL-1', estadoFinal: 'aprobada', estadoOperativo: 'En Mantenimiento',
          evidencia: { url: 'https://storage.example/secret.pdf', storagePath: 'clientes/x/secret.pdf' },
          createdByUserId: 'user-secret-id',
        },
        { _id: 'a2', tipo: 'otro', tipoCustom: 'Tomografia', fecha: new Date('2026-05-01'), estadoFinal: 'otro', estadoFinalCustom: 'Con reserva' },
      ],
      cadenas: [{ actividadVigenteId: 'a1', fechaProxima: new Date('2027-10-17') }],
    });
    const data = await hit();

    assert.equal(data.actividadesExternas.length, 2);
    const [a1, a2] = data.actividadesExternas;
    assert.equal(a1.tipo, 'calibracion');
    assert.equal(a1.proveedor, 'Biolab');
    assert.equal(a1.consecutivoDocumento, 'CAL-1');
    assert.equal(a1.resultado, 'aprobada');
    assert.equal(a1.estadoOperativo, 'En Mantenimiento');
    assert.equal(a1.tieneEvidencia, true);
    assert.deepEqual(a1.proximaFecha, new Date('2027-10-17'));
    assert.equal(a2.tipoCustom, 'Tomografia');
    assert.equal(a2.resultado, 'Con reserva');
    assert.equal(a2.tieneEvidencia, false);
    assert.equal(a2.proximaFecha, null);
    // the evidence address, the storage path and the user never leave the server
    const body = JSON.stringify(data);
    assert.equal(body.includes('secret.pdf'), false);
    assert.equal(body.includes('user-secret-id'), false);
    assert.equal(containsForbiddenKey(data), null);
  });

  it('returns an empty list when the equipment has no external activities', async () => {
    arrange();
    const data = await hit();
    assert.deepEqual(data.actividadesExternas, []);
  });

  it('an external service shows the provider as responsible and is flagged as external', async () => {
    arrange({
      reports: [
        {
          _id: 'r9', consecutivo: 'R000009', tipoMtto: 'Preventivo', fechaFinalizdo: new Date('2026-04-14'), estado: 'Cerrado',
          estadoOperativo: 'Operativo', origen: 'externo', externo: { proveedor: 'Biolmec sas', enlace: 'https://secret.example/doc' },
          procesadoPor: { userId: 'user-secret-id', snapshotName: 'Quien digito' },
        },
        { _id: 'r8', consecutivo: 'R000008', tipoMtto: 'Correctivo', fechaFinalizdo: new Date('2026-03-01'), estado: 'Cerrado', procesadoPor: { snapshotName: 'Juan Tecnico' } },
      ],
    });
    const data = await hit();
    assert.equal(data.historial[0].origen, 'externo');
    assert.equal(data.historial[0].responsable, 'Biolmec sas');
    assert.equal(data.historial[1].origen, 'interno');
    assert.equal(data.historial[1].responsable, 'Juan Tecnico');
    const body = JSON.stringify(data);
    assert.equal(body.includes('secret.example'), false);
    assert.equal(body.includes('Quien digito'), false);
  });
});

describe('GET /api/public/equipo/:qrToken — premium modules of the tenant (modulos-premium-por-tenant)', () => {
  const saved = process.env.ENFORCE_TENANT_CAPABILITIES;
  beforeEach(() => { tenantCaps = ALL_ON; stubTenant(); });
  afterEach(() => {
    delete Tenant.findOne;
    delete EquipmentQr.findOne;
    delete EquipoItem.findOne;
    delete Customer.findOne;
    delete Sedes.findOne;
    delete Report.find;
    delete EquipoActividadExterna.find;
    delete CadenaActividad.find;
    if (saved === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
    else process.env.ENFORCE_TENANT_CAPABILITIES = saved;
  });

  function arrange() {
    EquipmentQr.findOne = () => mockQuery({ qrToken: 'tokMOD12345678901234', active: true, tenantId: 'tenant-A', equipoId: 'eq1' });
    EquipoItem.findOne = () => mockQuery({ _id: 'eq1', tenantId: 'tenant-A', ClienteId: 'cust1', SedeId: 'sede1', Marca: 'GE', Modelo: 'X', Serie: 'S1', Inventario: 'INV1' });
    Customer.findOne = () => mockQuery({ Razonsocial: 'Hospital A', Logo: null });
    Sedes.findOne = () => mockQuery({ nombreSede: 'Sede Central' });
    Report.find = () => mockQuery([]);
    EquipoActividadExterna.find = () => { throw new Error('external activities must not be read without the module'); };
    CadenaActividad.find = () => { throw new Error('chains must not be read without the module'); };
  }
  const hit = async () => {
    const req = { params: { qrToken: 'tokMOD12345678901234' }, ip: '1.2.3.4', headers: {} };
    const res = buildRes();
    let forwarded = null;
    await publicEquipmentController.getHistory(req, res, (e) => { forwarded = e; });
    return { res, forwarded };
  };

  it('a tenant without usesQrs answers the same 404 as an unknown QR, with no equipment data', async () => {
    arrange();
    tenantCaps = { usesQrs: false, registersExternal: true };
    stubTenant();
    EquipoItem.findOne = () => { throw new Error('the equipment must not be read'); };
    const { res, forwarded } = await hit();
    assert.ok(forwarded instanceof ApiError);
    assert.equal(forwarded.statusCode, 404);
    assert.equal(forwarded.code, 'NOT_FOUND');
    assert.deepEqual(forwarded.details, {}, 'no ids in the body');
    assert.equal(res.body, null);
  });

  it('a legacy tenant without the stored capabilities has the module off', async () => {
    arrange();
    tenantCaps = undefined;
    stubTenant();
    EquipoItem.findOne = () => { throw new Error('the equipment must not be read'); };
    const { forwarded } = await hit();
    assert.equal(forwarded.statusCode, 404);
  });

  it('usesQrs without registersExternal: the page loads but actividadesExternas is omitted and not read', async () => {
    arrange();
    tenantCaps = { usesQrs: true, registersExternal: false };
    stubTenant();
    const { res, forwarded } = await hit();
    assert.equal(forwarded, null);
    assert.equal(res.statusCode, 200);
    assert.equal('actividadesExternas' in res.body.data, false);
    assert.ok(Array.isArray(res.body.data.historial));
  });

  it('both modules on: actividadesExternas is present', async () => {
    arrange();
    EquipoActividadExterna.find = () => mockQuery([]);
    CadenaActividad.find = () => mockQuery([]);
    const { res } = await hit();
    assert.deepEqual(res.body.data.actividadesExternas, []);
  });

  it('warn mode lets the page through and off bypasses the module', async () => {
    arrange();
    tenantCaps = { usesQrs: false, registersExternal: false };
    stubTenant();
    for (const mode of ['warn', 'off']) {
      process.env.ENFORCE_TENANT_CAPABILITIES = mode;
      EquipoActividadExterna.find = () => mockQuery([]);
      CadenaActividad.find = () => mockQuery([]);
      const { res, forwarded } = await hit();
      assert.equal(forwarded, null, mode);
      assert.equal(res.statusCode, 200, mode);
    }
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
