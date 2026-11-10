/**
 * Safe cells and file names for generated exports (change: requisiciones-e5-reporteria, task 2.3).
 * ONE helper for every Excel text cell of the requisitions exports: a string that starts with `=`, `+`, `-`, `@`, a tab or a
 * carriage return would be interpreted as a formula (CSV/formula injection), so it gets a leading apostrophe.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Value of a cell. Numbers, booleans and dates are kept as they are; null / undefined become an empty cell; any other value
 * becomes text and is prefixed with an apostrophe when it could be read as a formula. Objects are never written raw.
 */
export function safeCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value instanceof Date) return value;
  const text = typeof value === 'string' ? value : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Row of safe cells. */
export const safeRow = (values) => values.map(safeCell);

/** Letters, digits, dot, dash and underscore only (anything else -> `_`); never empty, never a hidden / traversal name. */
export function safeFilenamePart(value, fallback = 'requisicion') {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 60);
  return cleaned || fallback;
}

/** `Content-Disposition` value for an attachment whose name is built from the sanitized part and a fixed extension. */
export const attachmentHeader = (part, ext, fallback) => `attachment; filename="${safeFilenamePart(part, fallback)}.${ext}"`;
