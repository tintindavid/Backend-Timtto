import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';

const orig = EquipoActividadExterna.aggregate;
afterEach(() => { EquipoActividadExterna.aggregate = orig; });

describe('equipoItemService._attachUltimaActividadExterna', () => {
  it('adds the latest activity date per equipment, null when none, one query for the page', async () => {
    let calls = 0; let pipeline;
    EquipoActividadExterna.aggregate = async (p) => { calls += 1; pipeline = p; return [{ _id: 'e1', ultima: new Date('2026-10-17') }]; };
    const equipos = [{ _id: 'e1', tenantId: 't1' }, { _id: 'e2', tenantId: 't1' }];
    await equipoItemService._attachUltimaActividadExterna(equipos);
    assert.equal(calls, 1);
    assert.deepEqual(equipos[0].UltimaActividadExterna, new Date('2026-10-17'));
    assert.equal(equipos[1].UltimaActividadExterna, null);
    assert.deepEqual(pipeline[0].$match.tenantId, { $in: ['t1'] });
    assert.equal(pipeline[0].$match.isDeleted, false);
  });

  it('does nothing for an empty page and never throws if the aggregate fails', async () => {
    let calls = 0;
    EquipoActividadExterna.aggregate = async () => { calls += 1; throw new Error('boom'); };
    await equipoItemService._attachUltimaActividadExterna([]);
    assert.equal(calls, 0);
    const equipos = [{ _id: 'e1', tenantId: 't1' }];
    await equipoItemService._attachUltimaActividadExterna(equipos);
    assert.equal(equipos[0].UltimaActividadExterna, undefined);
  });
});

describe('equipoItemService.list: UltimaActividadExterna follows the module "Servicios de terceros"', () => {
  const origFind = EquipoItem.find;
  const origCount = EquipoItem.countDocuments;
  const savedMode = process.env.ENFORCE_TENANT_CAPABILITIES;
  let aggregates;
  afterEach(() => {
    EquipoItem.find = origFind;
    EquipoItem.countDocuments = origCount;
    if (savedMode === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
    else process.env.ENFORCE_TENANT_CAPABILITIES = savedMode;
  });
  const arrange = () => {
    aggregates = 0;
    const q = { populate: () => q, sort: () => q, skip: () => q, limit: () => q, lean: () => Promise.resolve([{ _id: 'e1', tenantId: 't1' }]) };
    EquipoItem.find = () => q;
    EquipoItem.countDocuments = async () => 1;
    EquipoActividadExterna.aggregate = async () => { aggregates += 1; return [{ _id: 'e1', ultima: new Date('2026-10-17') }]; };
  };

  it('is added when the tenant has registersExternal', async () => {
    arrange();
    const r = await equipoItemService.list({}, {}, 't1', { executesServices: true, registersExternal: true });
    assert.deepEqual(r.data[0].UltimaActividadExterna, new Date('2026-10-17'));
    assert.equal(aggregates, 1);
  });

  it('is not added, and not even queried, without the module', async () => {
    arrange();
    for (const caps of [{ executesServices: true, registersExternal: false }, undefined]) {
      const r = await equipoItemService.list({}, {}, 't1', caps);
      assert.equal('UltimaActividadExterna' in r.data[0], false);
    }
    assert.equal(aggregates, 0);
  });

  it('the rollout switch warn/off keeps the old behavior (field included)', async () => {
    arrange();
    process.env.ENFORCE_TENANT_CAPABILITIES = 'off';
    const r = await equipoItemService.list({}, {}, 't1', { registersExternal: false });
    assert.ok(r.data[0].UltimaActividadExterna);
  });
});
