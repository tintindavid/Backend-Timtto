/**
 * requisiciones-e1-base-aprobacion, tasks 2.1 / 2.2: money helper, period helper and the yearly consecutivo.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { roundMoney, sumMoney, multiplyMoney, isValidMoney, toCents } from '../../src/utils/money.util.js';
import { getYearInBogota, periodoToRange } from '../../src/utils/requisicionPeriod.util.js';
import { getNextRequisicionConsecutivo } from '../../src/services/counter.service.js';
import { Counter } from '../../src/models/counter.model.js';
import {
  REQUISICION_ESTADO,
  REQUISICION_TRANSICIONES,
  REQUISICION_ESTADOS_TERMINALES,
  REQUISICION_COUNTER_KEY,
} from '../../src/constants/requisicion.constants.js';

describe('money.util', () => {
  it('rounds to 2 decimals, half away from zero, and tolerates garbage', () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(roundMoney(2.675), 2.68);
    assert.equal(roundMoney(-1.005), -1.01);
    assert.equal(roundMoney('12.345'), 12.35);
    assert.equal(roundMoney(NaN), 0);
    assert.equal(roundMoney(undefined), 0);
    assert.equal(roundMoney(Infinity), 0);
  });

  it('sums without floating point drift', () => {
    assert.equal(sumMoney([0.1, 0.2]), 0.3);
    assert.equal(sumMoney([0.1, 0.2, 0.3]), 0.6);
    assert.equal(sumMoney([]), 0);
    assert.equal(sumMoney([1000000.1, 2000000.2]), 3000000.3);
  });

  it('multiplies quantity by unit price rounded to 2 decimals', () => {
    assert.equal(multiplyMoney(3, 0.1), 0.3);
    assert.equal(multiplyMoney(1.5, 10.01), 15.02);
    assert.equal(multiplyMoney('2', '5'), 10);
    assert.equal(multiplyMoney(undefined, 5), 0);
  });

  it('validates non-negative finite numbers', () => {
    assert.ok(isValidMoney(0));
    assert.ok(isValidMoney(10.5));
    assert.ok(!isValidMoney(-1));
    assert.ok(!isValidMoney('10'));
    assert.ok(!isValidMoney(NaN));
    assert.equal(toCents(10.555), 1056);
  });
});

describe('requisicionPeriod.util', () => {
  it('resolves the year in America/Bogota, not in UTC', () => {
    // 2027-01-01 03:00 UTC is still 2026-12-31 22:00 in Bogota.
    assert.equal(getYearInBogota(new Date('2027-01-01T03:00:00Z')), 2026);
    assert.equal(getYearInBogota(new Date('2027-01-01T05:00:00Z')), 2027);
  });

  it('turns a period into a half-open Bogota range', () => {
    const y = periodoToRange('2026');
    assert.equal(y.from.toISOString(), '2026-01-01T05:00:00.000Z');
    assert.equal(y.to.toISOString(), '2027-01-01T05:00:00.000Z');
    const m = periodoToRange('2026-03');
    assert.equal(m.from.toISOString(), '2026-03-01T05:00:00.000Z');
    assert.equal(m.to.toISOString(), '2026-04-01T05:00:00.000Z');
    const dec = periodoToRange('2026-12');
    assert.equal(dec.to.toISOString(), '2027-01-01T05:00:00.000Z');
  });

  it('rejects malformed periods', () => {
    for (const p of ['2026-13', '26', '2026-1', 'abc', '', null, undefined, '2026-00']) assert.equal(periodoToRange(p), null, String(p));
  });
});

describe('getNextRequisicionConsecutivo', () => {
  const saved = {};
  let seqs;
  beforeEach(() => {
    seqs = new Map();
    saved.fou = Counter.findOneAndUpdate;
    Counter.findOneAndUpdate = (filter) => ({
      lean: async () => {
        await Promise.resolve();
        const k = `${filter.tenantId}|${filter.key}`;
        seqs.set(k, (seqs.get(k) || 0) + 1);
        return { seq: seqs.get(k) };
      },
    });
  });
  afterEach(() => { Counter.findOneAndUpdate = saved.fou; });

  it('formats REQ-{YEAR}-{NNNN} per tenant and year', async () => {
    const a = await getNextRequisicionConsecutivo('t1', 2026);
    assert.deepEqual(a, { consecutivo: 'REQ-2026-0001', year: 2026, seq: 1 });
    assert.equal((await getNextRequisicionConsecutivo('t1', 2026)).consecutivo, 'REQ-2026-0002');
  });

  it('restarts at 0001 for a new year and is independent per tenant', async () => {
    await getNextRequisicionConsecutivo('t1', 2026);
    assert.equal((await getNextRequisicionConsecutivo('t1', 2027)).consecutivo, 'REQ-2027-0001');
    assert.equal((await getNextRequisicionConsecutivo('t2', 2026)).consecutivo, 'REQ-2026-0001');
    assert.ok(seqs.has(`t1|${REQUISICION_COUNTER_KEY(2026)}`));
  });

  it('resolves the numbering year of a Date in Bogota time', async () => {
    const r = await getNextRequisicionConsecutivo('t1', new Date('2027-01-01T03:00:00Z'));
    assert.equal(r.year, 2026);
  });

  it('concurrent creations get distinct consecutive numbers', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => getNextRequisicionConsecutivo('t1', 2026)));
    const seq = results.map((r) => r.seq).sort((a, b) => a - b);
    assert.deepEqual(seq, Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(new Set(results.map((r) => r.consecutivo)).size, 20);
  });

  it('requires a tenant', async () => {
    await assert.rejects(() => getNextRequisicionConsecutivo('', 2026), /TenantId/);
  });
});

describe('requisicion.constants transition table', () => {
  it('matches the E1 state machine', () => {
    const T = REQUISICION_TRANSICIONES;
    const E = REQUISICION_ESTADO;
    assert.deepEqual([...T[E.BORRADOR]].sort(), [E.CANCELADA, E.ENVIADA].sort());
    assert.deepEqual([...T[E.ENVIADA]].sort(), [E.CANCELADA, E.EN_APROBACION].sort());
    assert.deepEqual([...T[E.EN_APROBACION]].sort(), [E.APROBADA, E.BORRADOR, E.CANCELADA, E.RECHAZADA].sort());
    assert.deepEqual([...T[E.RECHAZADA]].sort(), [E.BORRADOR, E.CANCELADA].sort());
    assert.deepEqual(T[E.CANCELADA], []);
    assert.deepEqual(REQUISICION_ESTADOS_TERMINALES, [E.CANCELADA]);
  });
});
