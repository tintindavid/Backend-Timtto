'use strict';

/**
 * Formats a user's display name as "M. Duran" — first-name initial + first
 * word of the last name. Used to freeze `snapshotName` on a `ScheduleEntry`
 * (design.md D8, ot-responsables-programacion-trazable) and to render the
 * "Responsable(s)" column.
 *
 * Rules:
 *   - `{ firstName: 'Martin', lastName: 'Duran' }` -> "M. Duran"
 *   - Compound last names use only the first word: `{ firstName: 'Martin',
 *     lastName: 'Duran Martinez' }` -> "M. Duran"
 *   - Missing `firstName` falls back to the local-part of `email`:
 *     `{ email: 'jdoe@timtto.com' }` -> "jdoe"
 *   - Nothing usable at all -> "?"
 *
 * @param {{ firstName?: string, lastName?: string, email?: string }} [user]
 * @returns {string}
 *
 * @example
 *   nameShort({ firstName: 'Martin', lastName: 'Duran' }); // "M. Duran"
 *   nameShort({ firstName: 'Martin', lastName: 'Duran Martinez' }); // "M. Duran"
 *   nameShort({ email: 'jdoe@timtto.com' }); // "jdoe"
 *   nameShort({}); // "?"
 */
export function nameShort(user = {}) {
  const { firstName, lastName, email } = user || {};
  const first = typeof firstName === 'string' ? firstName.trim() : '';
  const last = typeof lastName === 'string' ? lastName.trim() : '';

  if (first) {
    const initial = first.charAt(0).toUpperCase();
    if (last) {
      const lastFirstWord = last.split(/\s+/)[0];
      return `${initial}. ${lastFirstWord}`;
    }
    return `${initial}.`;
  }

  if (typeof email === 'string' && email.trim()) {
    const local = email.trim().split('@')[0];
    if (local) return local;
  }

  return '?';
}
