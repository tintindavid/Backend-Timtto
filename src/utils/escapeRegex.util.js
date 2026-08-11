'use strict';

/**
 * Escapes RegExp metacharacters so a user-supplied search term is treated as
 * a literal substring, not a pattern. Prevents regex-injection DoS (a term
 * like `.*` would otherwise trigger catastrophic backtracking on large
 * collections) and false-positive matches from stray meta chars in the input.
 */
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default escapeRegex;
