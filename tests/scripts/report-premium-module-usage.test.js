import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportModuleUsage } from '../../scripts/2026-10-20-report-premium-module-usage.js';

/** Fake Db: `data[collection]` is the list of documents; aggregate groups by tenantId honouring $match. */
const fakeDb = (data) => ({
  collection: (name) => ({
    find: () => ({ toArray: async () => data[name] ?? [] }),
    aggregate: (pipeline) => ({
      toArray: async () => {
        const match = pipeline[0].$match;
        const docs = (data[name] ?? []).filter((d) => d.isDeleted !== true && (match.origen === undefined || d.origen === match.origen));
        const counts = new Map();
        for (const d of docs) counts.set(d.tenantId, (counts.get(d.tenantId) ?? 0) + 1);
        return [...counts].map(([_id, n]) => ({ _id, n }));
      },
    }),
  }),
});

describe('reportModuleUsage', () => {
  it('lists tenants that use a module that is off, and only those', async () => {
    const db = fakeDb({
      tenants: [
        { _id: 'id-a', tenantId: 'a', name: 'A' }, // legacy: no capabilities -> both off
        { tenantId: 'b', name: 'B', capabilities: { executesServices: true, registersExternal: true, usesQrs: true } },
        { tenantId: 'c', name: 'C', capabilities: { executesServices: true, registersExternal: false } },
        { tenantId: 'gone', name: 'Gone', isDeleted: true },
      ],
      equipment_qrs: [{ tenantId: 'a' }, { tenantId: 'a' }, { tenantId: 'b' }],
      service_qrs: [],
      tickets: [{ tenantId: 'a' }, { tenantId: 'gone' }],
      'equipo-actividades-externas': [{ tenantId: 'a' }, { tenantId: 'b' }, { tenantId: 'a', isDeleted: true }],
      reports: [{ tenantId: 'a', origen: 'externo' }, { tenantId: 'a', origen: 'interno' }],
    });
    const { rows, needsEnabling } = await reportModuleUsage(db);
    assert.deepEqual(rows.map((r) => r.tenantId), ['a', 'b', 'c']);
    const a = rows.find((r) => r.tenantId === 'a');
    assert.deepEqual({ qr: a.equipmentQrs, t: a.tickets, ea: a.externalActivities, er: a.externalReports }, { qr: 2, t: 1, ea: 1, er: 1 });
    assert.deepEqual(a.enable, ['usesQrs', 'registersExternal']);
    assert.equal(a.id, 'id-a', 'the PATCH needs the Mongo _id, not the tenantId');
    assert.deepEqual(rows.find((r) => r.tenantId === 'b').enable, [], 'already on');
    assert.deepEqual(rows.find((r) => r.tenantId === 'c').enable, [], 'no usage');
    assert.deepEqual(needsEnabling.map((r) => r.tenantId), ['a']);
  });
});
