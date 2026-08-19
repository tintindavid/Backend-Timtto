'use strict';

/**
 * Shared serial-normalization helpers — equipo-duplicate-detection-and-replace.
 *
 * Mirrored (identical semantics) in TimttoFrontend/src/utils/serial.ts. Both
 * implementations are tested against the same fixture file
 * (ai-specs/fixtures/serial-normalize.fixtures.json) to prevent drift.
 */

/**
 * Normalizes a raw serial/marca string for comparison purposes only.
 * Trims leading/trailing whitespace, collapses internal whitespace runs to a
 * single ASCII space, and upper-cases the result. Non-string input returns ''.
 *
 * @param {*} raw
 * @returns {string}
 */
export function normalizeSerial(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * A normalized serial is "digit-bearing" when it contains at least one
 * Unicode digit. Purely alphabetic / placeholder serials ("N/V", "SIN
 * SERIE", "No tiene") are not digit-bearing and are exempt from uniqueness.
 *
 * @param {string} normalized
 * @returns {boolean}
 */
export function serialHasDigit(normalized) {
  return /\d/.test(normalized || '');
}
