'use strict';

import { ApiError } from './apiError.util.js';

/**
 * Returns the OT's currently-active `ScheduleEntry`, or `null` when the OT
 * has no `programaciones` (never programmed) or none of them are active
 * (should not normally happen, but is treated as "no active roster" —
 * design.md D6).
 *
 * @param {{ programaciones?: Array<{ isActive?: boolean, responsables?: Array<{ userId: any, snapshotName: string }> }> }} ot
 * @returns {null | { isActive: boolean, responsables: Array<{ userId: any, snapshotName: string }> }}
 */
function getActiveEntry(ot) {
  const programaciones = ot?.programaciones;
  if (!Array.isArray(programaciones) || programaciones.length === 0) return null;
  return programaciones.find((p) => p && p.isActive === true) || null;
}

/**
 * Computes whether `user` may perform "trabajar" actions on `ot` (design.md
 * D6). Retro-compatible: an OT with no `programaciones` (or no active
 * entry) is permissive for everyone. Superadmin/admin do NOT bypass this —
 * the caller must be in the active roster.
 *
 * @param {{ userId?: string }} user
 * @param {object} ot - an OT document/lean object (must carry `programaciones`)
 * @returns {boolean}
 *
 * @example
 *   computeCanWork({ userId: 'u1' }, { programaciones: [] }); // true (retro-compat)
 *   computeCanWork({ userId: 'u1' }, otWithActiveRosterContainingU1); // true
 *   computeCanWork({ userId: 'u2' }, otWithActiveRosterContainingU1); // false
 */
export function computeCanWork(user, ot) {
  const active = getActiveEntry(ot);
  if (!active) return true;
  const userId = String(user?.userId || '');
  const responsables = Array.isArray(active.responsables) ? active.responsables : [];
  return responsables.some((r) => String(r.userId) === userId);
}

/**
 * Guard for service methods that mutate work state on a report/sheet
 * belonging to an OT (design.md D3/D7). Throws `403 NOT_RESPONSIBLE` with
 * `details.responsables` (the active roster, `{ userId, name }` pairs) when
 * `user` is not part of the OT's active programación. No-op (returns
 * undefined) when the guard passes or the OT has no active programación.
 *
 * @param {{ userId?: string }} user
 * @param {object} ot
 * @throws {ApiError} 403 NOT_RESPONSIBLE
 *
 * @example
 *   assertUserCanWork(req.user, ot); // throws if req.user isn't in the active roster
 */
export function assertUserCanWork(user, ot) {
  const active = getActiveEntry(ot);
  if (!active) return;
  const userId = String(user?.userId || '');
  const responsables = Array.isArray(active.responsables) ? active.responsables : [];
  const isResponsible = responsables.some((r) => String(r.userId) === userId);
  if (isResponsible) return;

  throw new ApiError(
    403,
    'Solo los responsables asignados pueden trabajar esta OT.',
    'NOT_RESPONSIBLE',
    {
      responsables: responsables.map((r) => ({ userId: String(r.userId), name: r.snapshotName })),
    },
  );
}
