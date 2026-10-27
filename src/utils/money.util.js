'use strict';

/**
 * Money helper (change: requisiciones-e1-base-aprobacion, design D5): amounts are plain Numbers rounded to
 * 2 decimals. Every monetary calculation of the requisitions module goes through here so rounding is uniform.
 * Sums are done in integer cents to avoid accumulating binary floating point error.
 */

export const MONEY_DECIMALS = 2;

/** Rounds to 2 decimals (half away from zero). Non-finite input returns 0. */
export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

export function toCents(value) {
  return Math.round(roundMoney(value) * 100);
}

/** Sum of amounts, rounded to 2 decimals. */
export function sumMoney(values = []) {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return cents / 100;
}

/** quantity x unit price, rounded to 2 decimals. */
export function multiplyMoney(quantity, unitPrice) {
  const q = Number(quantity);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return roundMoney(q * p);
}

export function isValidMoney(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
