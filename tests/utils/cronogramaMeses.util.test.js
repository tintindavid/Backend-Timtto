/**
 * tests/utils/cronogramaMeses.util.test.js
 * cronograma-actividades-externas, tasks 3.1 / 4.2. Pure functions, no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMesesRecurrentes, calcularVencimiento, MESES_ABREV } from '../../src/utils/cronogramaMeses.util.js';

describe('calcularMesesRecurrentes', () => {
  it('semiannual chain due in March falls in March and September', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-03-10T00:00:00Z'), 6), ['mar', 'sep']);
  });

  it('annual chain due in November has a single month', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-11-05T00:00:00Z'), 12), ['nov']);
  });

  it('monthly chain has all twelve months', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-07-01T00:00:00Z'), 1), MESES_ABREV);
  });

  it('quarterly chain wraps the year and is returned in calendar order', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-11-20T00:00:00Z'), 3), ['feb', 'may', 'ago', 'nov']);
  });

  it('a frequency longer than a year keeps only the month of the due date', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-05-10T00:00:00Z'), 24), ['may']);
  });

  it('a frequency that does not divide twelve repeats within the year only', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-01-10T00:00:00Z'), 5), ['ene', 'jun', 'nov']);
  });

  it('accepts an ISO string', () => {
    assert.deepEqual(calcularMesesRecurrentes('2026-03-10T00:00:00.000Z', 6), ['mar', 'sep']);
  });

  it('missing or invalid frequency keeps the month of the due date', () => {
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-04-01T00:00:00Z'), undefined), ['abr']);
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-04-01T00:00:00Z'), 0), ['abr']);
    assert.deepEqual(calcularMesesRecurrentes(new Date('2026-04-01T00:00:00Z'), -3), ['abr']);
  });

  it('an invalid date gives no months', () => {
    assert.deepEqual(calcularMesesRecurrentes('not-a-date', 6), []);
    assert.deepEqual(calcularMesesRecurrentes(null, 6), []);
  });
});

describe('calcularMesesRecurrentes with a year', () => {
  const d = (iso) => new Date(`${iso}T00:00:00Z`);

  it('semiannual chain: the same two months in any year', () => {
    assert.deepEqual(calcularMesesRecurrentes(d('2026-03-10'), 6, { anio: 2026 }), ['mar', 'sep']);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-03-10'), 6, { anio: 2025 }), ['mar', 'sep']);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-03-10'), 6, { anio: 2030 }), ['mar', 'sep']);
  });

  it('nothing is scheduled before the chain started', () => {
    // monthly chain whose first activity was in September 2026
    assert.deepEqual(
      calcularMesesRecurrentes(d('2026-10-25'), 1, { anio: 2026, desde: d('2026-09-25') }),
      ['sep', 'oct', 'nov', 'dic'],
    );
    assert.deepEqual(calcularMesesRecurrentes(d('2026-10-25'), 1, { anio: 2025, desde: d('2026-09-25') }), []);
  });

  it('a year after the start shows the full pattern', () => {
    assert.equal(calcularMesesRecurrentes(d('2026-10-25'), 1, { anio: 2027, desde: d('2026-09-25') }).length, 12);
  });

  it('annual chain started in January 2025 is scheduled in January of each year from then on', () => {
    const args = { desde: d('2025-01-13') };
    assert.deepEqual(calcularMesesRecurrentes(d('2027-01-21'), 12, { anio: 2025, ...args }), ['ene']);
    assert.deepEqual(calcularMesesRecurrentes(d('2027-01-21'), 12, { anio: 2026, ...args }), ['ene']);
    assert.deepEqual(calcularMesesRecurrentes(d('2027-01-21'), 12, { anio: 2024, ...args }), []);
  });

  it('frequencies that do not divide twelve follow the real sequence instead of drifting', () => {
    // every 5 months from Jan 2026: Jan, Jun, Nov 2026; Apr, Sep 2027
    assert.deepEqual(calcularMesesRecurrentes(d('2026-01-10'), 5, { anio: 2026 }), ['ene', 'jun', 'nov']);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-01-10'), 5, { anio: 2027 }), ['abr', 'sep']);
  });

  it('a frequency above twelve only schedules the years it falls in', () => {
    assert.deepEqual(calcularMesesRecurrentes(d('2026-05-10'), 24, { anio: 2026 }), ['may']);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-05-10'), 24, { anio: 2027 }), []);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-05-10'), 24, { anio: 2028 }), ['may']);
  });

  it('a missing frequency schedules only the month of the due date', () => {
    assert.deepEqual(calcularMesesRecurrentes(d('2026-04-01'), undefined, { anio: 2026 }), ['abr']);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-04-01'), undefined, { anio: 2027 }), []);
  });

  it('an invalid date or desde is handled', () => {
    assert.deepEqual(calcularMesesRecurrentes(null, 6, { anio: 2026 }), []);
    assert.deepEqual(calcularMesesRecurrentes(d('2026-03-10'), 6, { anio: 2026, desde: 'nope' }), ['mar', 'sep']);
  });
});

describe('calcularVencimiento', () => {
  const now = new Date('2026-10-19T15:00:00Z');

  it('overdue by 10 days', () => {
    assert.deepEqual(calcularVencimiento(new Date('2026-10-09T00:00:00Z'), now), { vencida: true, diasParaVencer: -10 });
  });

  it('due in 20 days', () => {
    assert.deepEqual(calcularVencimiento(new Date('2026-11-08T00:00:00Z'), now), { vencida: false, diasParaVencer: 20 });
  });

  it('due today is not overdue, whatever the time of day', () => {
    assert.deepEqual(calcularVencimiento(new Date('2026-10-19T00:00:00Z'), now), { vencida: false, diasParaVencer: 0 });
    assert.deepEqual(calcularVencimiento(new Date('2026-10-19T23:59:00Z'), now), { vencida: false, diasParaVencer: 0 });
  });

  it('yesterday is overdue by one day', () => {
    assert.deepEqual(calcularVencimiento(new Date('2026-10-18T23:59:00Z'), now), { vencida: true, diasParaVencer: -1 });
  });

  it('an invalid date is neither overdue nor countable', () => {
    assert.deepEqual(calcularVencimiento('nope', now), { vencida: false, diasParaVencer: null });
  });
});
