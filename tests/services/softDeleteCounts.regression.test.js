/**
 * Regression (found against real MongoDB): `countDocuments` does NOT run the schema's `pre(/^find/)` soft-delete
 * hook, so list totals counted soft-deleted rows and a soft-deleted budget blocked deleting its area.
 * Every count in the list services must carry `isDeleted: { $ne: true }` explicitly.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { User } from '../../src/models/user.model.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { presupuestoAreaService } from '../../src/services/presupuestoArea.service.js';
import { requisicionService } from '../../src/services/requisicion.service.js';

const chain = (rows) => {
  const q = { sort: () => q, skip: () => q, limit: () => q, select: () => q, lean: async () => rows, then: (res, rej) => Promise.resolve(rows).then(res, rej) };
  return q;
};
const saved = [];
function spy(model, counts) {
  const f = model.find; const c = model.countDocuments;
  saved.push(() => { model.find = f; model.countDocuments = c; });
  model.find = () => chain([]);
  model.countDocuments = (filter) => { counts.push(filter); return { setOptions: () => Promise.resolve(0), then: (res) => Promise.resolve(0).then(res) }; };
}
afterEach(() => { while (saved.length) saved.pop()(); });

describe('list totals exclude soft-deleted rows', () => {
  const cases = [
    ['area', Area, () => areaService.list('t', {}, {})],
    ['tipo', TipoRequisicion, () => tipoRequisicionService.list('t', {}, {})],
    ['regla', ReglaAprobacion, () => reglaAprobacionService.list('t', {}, {})],
    ['presupuesto', PresupuestoArea, () => presupuestoAreaService.list('t', {}, {})],
    ['requisicion', Requisicion, () => requisicionService.list('t', '64b000000000000000000001', {}, {})],
  ];
  for (const [name, model, run] of cases) {
    it(`${name}.list counts with isDeleted != true`, async () => {
      const counts = [];
      spy(model, counts);
      await run();
      assert.equal(counts.length, 1);
      assert.deepEqual(counts[0].isDeleted, { $ne: true });
      assert.equal(counts[0].tenantId, 't');
    });
  }

  it('area.delete ignores soft-deleted budgets when checking usage', async () => {
    const counts = [];
    const origExists = Area.findOne; const origUser = User.countDocuments; const origUpdate = Area.findOneAndUpdate;
    spy(Requisicion, []); spy(PresupuestoArea, counts);
    Area.findOne = () => ({ lean: async () => ({ _id: 'x' }) });
    User.countDocuments = async () => 0;
    Area.findOneAndUpdate = async () => ({ _id: 'x' });
    saved.push(() => { Area.findOne = origExists; User.countDocuments = origUser; Area.findOneAndUpdate = origUpdate; });
    await areaService.delete('t', '64b000000000000000000002');
    assert.deepEqual(counts[0].isDeleted, { $ne: true });
  });
});
