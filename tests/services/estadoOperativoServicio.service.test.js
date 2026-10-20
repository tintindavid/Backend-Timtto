/**
 * tests/services/estadoOperativoServicio.service.test.js
 * reportes-externos-mp-mc: the operative state follows the last service by date.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ultimoCambioDeEstado,
  esServicioAtrasadoParaEstado,
  aplicarEstadoDeServicio,
} from '../../src/services/estadoOperativoServicio.service.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';

const saved = equipoItemService._appendEstadoOperativoHistory;
afterEach(() => { equipoItemService._appendEstadoOperativoHistory = saved; });

const entry = (over) => ({ from: 'Operativo', to: 'En Reparacion', source: 'manual', at: new Date('2026-05-10T10:00:00Z'), ...over });

describe('ultimoCambioDeEstado', () => {
  it('is null without history', () => {
    assert.equal(ultimoCambioDeEstado(undefined), null);
    assert.equal(ultimoCambioDeEstado([]), null);
  });

  it('ignores the initial load: from null, bulk-upload and migration', () => {
    assert.equal(ultimoCambioDeEstado([
      entry({ from: null, at: new Date('2026-10-20') }),
      entry({ source: 'bulk-upload', at: new Date('2026-10-20') }),
      entry({ source: 'migration', at: new Date('2026-10-20') }),
    ]), null);
  });

  it('takes the most recent real event whatever its position in the list', () => {
    const last = ultimoCambioDeEstado([
      entry({ at: new Date('2026-09-08T00:00:00Z'), source: 'report-external' }),
      entry({ at: new Date('2026-02-01T00:00:00Z'), source: 'report-close' }),
      entry({ at: new Date('2026-07-01T00:00:00Z'), source: 'actividad-externa' }),
    ]);
    assert.equal(last.toISOString(), '2026-09-08T00:00:00.000Z');
  });

  it('skips malformed entries', () => {
    assert.equal(ultimoCambioDeEstado([null, {}, entry({ at: 'nope' })]), null);
  });
});

describe('esServicioAtrasadoParaEstado', () => {
  const equipo = { estadoOperativoHistory: [entry({ at: new Date('2026-05-10T10:00:00Z') })] };

  it('older day is late, same day and later are not', () => {
    assert.equal(esServicioAtrasadoParaEstado(equipo, new Date('2026-05-09T00:00:00Z')), true);
    assert.equal(esServicioAtrasadoParaEstado(equipo, new Date('2026-05-10T00:00:00Z')), false);
    assert.equal(esServicioAtrasadoParaEstado(equipo, new Date('2026-05-11T00:00:00Z')), false);
  });

  it('is never late for an equipment without real events', () => {
    assert.equal(esServicioAtrasadoParaEstado({ estadoOperativoHistory: [] }, new Date('2020-01-01')), false);
    assert.equal(esServicioAtrasadoParaEstado({}, new Date('2020-01-01')), false);
  });
});

describe('aplicarEstadoDeServicio', () => {
  const run = (equipo, over = {}) => {
    const calls = [];
    equipoItemService._appendEstadoOperativoHistory = async (id, next, opts) => { calls.push({ id, next, opts }); return {}; };
    return aplicarEstadoDeServicio({
      equipo: { _id: 'e1', ...equipo }, estadoOperativo: 'Operativo', fecha: new Date('2026-06-01T00:00:00Z'),
      source: 'actividad-externa', tenantId: 't1', ...over,
    }).then((res) => ({ res, calls }));
  };

  it('writes through the single history writer stamped with the service date and source', async () => {
    const { res, calls } = await run({ estadoOperativoHistory: [] });
    assert.equal(res.applied, true);
    assert.equal(calls[0].id, 'e1');
    assert.equal(calls[0].next, 'Operativo');
    assert.equal(calls[0].opts.source, 'actividad-externa');
    assert.equal(calls[0].opts.at.toISOString(), '2026-06-01T00:00:00.000Z');
    assert.equal(calls[0].opts.tenantId, 't1');
  });

  it('does nothing without a state', async () => {
    const { res, calls } = await run({}, { estadoOperativo: undefined });
    assert.equal(res.applied, false);
    assert.equal(calls.length, 0);
  });

  it('does not write when the service is older than the last real event', async () => {
    const { res, calls } = await run({ estadoOperativoHistory: [entry({ at: new Date('2026-08-01T00:00:00Z') })] });
    assert.equal(res.applied, false);
    assert.equal(calls.length, 0);
  });
});
