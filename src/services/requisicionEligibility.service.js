import { Area } from '../models/area.model.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { findDistinctAssignment } from '../utils/approverAssignment.util.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { APROBADOR_TIPO } from '../constants/requisicion.constants.js';

const sid = (v) => (v === null || v === undefined ? '' : String(v));
const holdsApprove = (role) => Boolean(role && (role.permissions || []).includes(PERMISSIONS.REQUISICIONES_APPROVE));

/**
 * Who can be an approver (single source for send time, rule configuration and reassignment).
 * RULE: an approver is a live user of the tenant whose role holds `requisiciones:approve`, regardless of how the
 * rule names him (area head, listed user or role member): both decision endpoints are gated by that permission.
 */

/** Subset of `ids` that are live users of the tenant holding `requisiciones:approve`. */
export async function usersWithApprove(tenantId, ids) {
  const wanted = [...new Set((ids || []).map(sid).filter(Boolean))];
  if (wanted.length === 0) return [];
  const users = await User.find({ _id: { $in: wanted }, tenantId }).select('_id roleId').lean();
  const roleIds = [...new Set(users.map((u) => sid(u.roleId)).filter(Boolean))];
  if (roleIds.length === 0) return [];
  const roles = await Role.find({ _id: { $in: roleIds }, tenantId }).select('_id permissions').lean();
  const ok = new Set(roles.filter(holdsApprove).map((r) => sid(r._id)));
  return users.filter((u) => ok.has(sid(u.roleId))).map((u) => sid(u._id));
}

/**
 * Eligible approver ids of a rule (before excluding creator / requester). `areaId` is only needed by `jefe_area`.
 * Rules whose approver is not configured (no area, role without the permission...) yield [].
 */
export async function eligibleIdsForRule(tenantId, regla, areaId) {
  if (regla.aprobadorTipo === APROBADOR_TIPO.JEFE_AREA) {
    if (!areaId) return [];
    const area = await Area.findOne({ _id: areaId, tenantId }).lean();
    return usersWithApprove(tenantId, area?.jefesIds || []);
  }
  if (regla.aprobadorTipo === APROBADOR_TIPO.USUARIOS) {
    return usersWithApprove(tenantId, regla.usuariosIds || []);
  }
  if (regla.aprobadorTipo === APROBADOR_TIPO.ROL && regla.rolId) {
    const role = await Role.findOne({ _id: regla.rolId, tenantId }).lean();
    if (!holdsApprove(role)) return [];
    const users = await User.find({ tenantId, roleId: regla.rolId }).select('_id').lean();
    return users.map((u) => sid(u._id));
  }
  return [];
}

/**
 * Checks that every level can get a DISTINCT approver. Throws 422 NIVEL_SIN_APROBADOR_ELEGIBLE before any change,
 * listing the offending levels in `details.niveles` (`details.orden` / `details.nombre` = the first one).
 *
 * @param {{ orden: number, nombre?: string, ids: string[] }[]} levels
 * @param {string} [context]  text appended to the message
 */
export function assertLevelsFeasible(levels, context = '') {
  const result = findDistinctAssignment(levels.map((l) => ({ key: l.orden, ids: l.ids })));
  if (result.feasible) return result.assignment;
  const byOrden = new Map(levels.map((l) => [l.orden, l]));
  const niveles = result.offending.map((orden) => ({ orden, nombre: byOrden.get(orden)?.nombre }));
  const names = niveles.map((n) => `"${n.nombre ?? n.orden}"`).join(', ');
  throw new ApiError(
    422,
    `Los niveles ${names} no tienen un aprobador elegible distinto (una misma persona no puede decidir dos niveles; solo cuentan usuarios con permiso de aprobar${context})`,
    'NIVEL_SIN_APROBADOR_ELEGIBLE',
    { niveles, orden: niveles[0]?.orden, nombre: niveles[0]?.nombre },
  );
}
