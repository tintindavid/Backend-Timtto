/**
 * requisiciones-datos-por-defecto-tenant, 4.5: full seed, idempotency, E1 adoption and protection against a real
 * MongoDB. SKIPPED unless MONGO_INTEGRATION_URI is set; throwaway standalone mongod only.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { seedRequisicionDefaults } from '../../src/services/requisicionSeed.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { areaService } from '../../src/services/area.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { presupuestoAreaService } from '../../src/services/presupuestoArea.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const sistema = { code: 'REGISTRO_SISTEMA', statusCode: 409 };

describe('requisiciones tenant defaults against a real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  before(async () => {
    await mongoose.connect(URI, { dbName: `req_defaults_${rnd()}` });
    await Promise.all([TipoRequisicion, Area, ReglaAprobacion, PresupuestoArea].map((m) => m.syncIndexes()));
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it('seeds an empty tenant, is idempotent and isolates tenants', async () => {
    const first = await seedRequisicionDefaults('alpha');
    assert.deepEqual(first, { tipos: 8, areas: 7, regla: 1, presupuesto: 1, adoptados: 0 });
    assert.deepEqual(await seedRequisicionDefaults('alpha'), { tipos: 0, areas: 0, regla: 0, presupuesto: 0, adoptados: 0 });
    assert.equal(await TipoRequisicion.countDocuments({ tenantId: 'alpha', esSistema: true }), 8);
    assert.equal(await Area.countDocuments({ tenantId: 'alpha', esSistema: true }), 7);
    const budget = await PresupuestoArea.findOne({ tenantId: 'alpha' }).lean();
    const admin = await Area.findOne({ tenantId: 'alpha', codigo: 'ADMINISTRACION' }).lean();
    assert.equal(String(budget.areaId), String(admin._id));
    assert.match(budget.periodo, /^\d{4}$/);
    assert.equal(budget.monto, 10000000);
    assert.equal(await TipoRequisicion.countDocuments({ tenantId: 'beta' }), 0);
  });

  it('5 concurrent seeds on one tenant leave exactly 1 rule, 1 budget, 8 types and 7 areas', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => seedRequisicionDefaults('gamma')));
    assert.equal(results.reduce((n, r) => n + r.regla, 0), 1);
    assert.equal(results.reduce((n, r) => n + r.presupuesto, 0), 1);
    assert.equal(await TipoRequisicion.countDocuments({ tenantId: 'gamma' }), 8);
    assert.equal(await Area.countDocuments({ tenantId: 'gamma' }), 7);
    assert.equal(await ReglaAprobacion.countDocuments({ tenantId: 'gamma' }), 1);
    assert.equal(await PresupuestoArea.countDocuments({ tenantId: 'gamma' }), 1);
    const budget = await PresupuestoArea.findOne({ tenantId: 'gamma' }).lean();
    const admin = await Area.findOne({ tenantId: 'gamma', codigo: 'ADMINISTRACION' }).lean();
    assert.equal(String(budget.areaId), String(admin._id));
  });

  it('the example budget uses the tenant currency', async () => {
    await mongoose.connection.collection('tenants').insertOne({ tenantId: 'delta', name: 'Delta', isDeleted: false, settings: { currency: 'usd' } });
    await seedRequisicionDefaults('delta');
    assert.equal((await PresupuestoArea.findOne({ tenantId: 'delta' }).lean()).moneda, 'USD');
  });

  it('adopts E1 data without touching other fields and keeps the existing rule', async () => {
    await TipoRequisicion.collection.insertOne({ tenantId: 'e1', codigo: 'SERVICIO', nombre: 'Mis servicios', activo: true, isDeleted: false });
    await Area.collection.insertOne({ tenantId: 'e1', codigo: 'GENERAL', nombre: 'General', jefesIds: [], activa: true, isDeleted: false });
    await ReglaAprobacion.collection.insertOne({ tenantId: 'e1', orden: 1, nombre: 'Mia', montoDesde: 0, montoHasta: null, aprobadorTipo: 'jefe_area', activo: true, isDeleted: false });
    const r = await seedRequisicionDefaults('e1');
    assert.deepEqual(r, { tipos: 7, areas: 7, regla: 0, presupuesto: 1, adoptados: 1 });
    const servicio = await TipoRequisicion.collection.findOne({ tenantId: 'e1', codigo: 'SERVICIO' });
    assert.equal(servicio.esSistema, true);
    assert.equal(servicio.nombre, 'Mis servicios');
    assert.equal((await Area.collection.findOne({ tenantId: 'e1', codigo: 'GENERAL' })).esSistema, undefined);
    assert.equal(await ReglaAprobacion.countDocuments({ tenantId: 'e1' }), 1);
  });

  it('protects the defaults through the services', async () => {
    const tipo = await TipoRequisicion.findOne({ tenantId: 'alpha', codigo: 'GENERAL' }).lean();
    await assert.rejects(() => tipoRequisicionService.delete('alpha', tipo._id), sistema);
    await assert.rejects(() => tipoRequisicionService.update('alpha', tipo._id, { activo: false }), sistema);
    await assert.rejects(() => tipoRequisicionService.update('alpha', tipo._id, { nombre: 'Otro' }), sistema);
    await tipoRequisicionService.update('alpha', tipo._id, { nombre: 'General', activo: true, descripcion: 'ok' });
    await assert.rejects(() => tipoRequisicionService.update('beta', tipo._id, { descripcion: 'x' }), { statusCode: 404 });

    const area = await Area.findOne({ tenantId: 'alpha', codigo: 'CALIDAD' }).lean();
    await assert.rejects(() => areaService.delete('alpha', area._id), sistema);
    await assert.rejects(() => areaService.update('alpha', area._id, { activa: false }), sistema);

    const regla = await ReglaAprobacion.findOne({ tenantId: 'alpha' }).lean();
    await assert.rejects(() => reglaAprobacionService.delete('alpha', regla._id), sistema);
    await assert.rejects(() => reglaAprobacionService.update('alpha', regla._id, { nombre: 'Otra' }), sistema);

    const budget = await PresupuestoArea.findOne({ tenantId: 'alpha' }).lean();
    await assert.rejects(() => presupuestoAreaService.delete('alpha', budget._id), sistema);
    await assert.rejects(() => presupuestoAreaService.update('alpha', budget._id, { periodo: '1999' }), sistema);
    const upd = await presupuestoAreaService.update('alpha', budget._id, { monto: 123 });
    assert.equal(upd.monto, 123);
    assert.equal(upd.esSistema, true);
  });
});
