import { Area } from '../models/area.model.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { logger } from '../config/logger.config.js';
import { notificationService } from './notification.service.js';
import { REQUISICION_PAYLOAD_BUILDERS } from './notifications/requisicionPayload.util.js';
import { APROBADOR_TIPO, NIVEL_ESTADO } from '../constants/requisicion.constants.js';
import { PERMISSIONS } from '../constants/permissions.js';

/**
 * Notifications of the requisition transitions (tasks 5.4). They run AFTER the atomic write, outside the critical
 * path: every emit is fire-and-forget with its own try/catch (log, never throw), so a notification failure can
 * never undo or block a transition. Recipients are dynamic and passed through `extraRecipientUserIds`.
 */

const pending = new Set();

/** Resolves when every notification started so far has settled (tests; graceful shutdown). */
export async function flushRequisicionNotifications() {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

const unique = (ids) => [...new Set(ids.filter(Boolean).map(String))];

/** Eligible approvers of an approval level: the frozen ids plus, for `rol` levels, the users holding the role LIVE. */
export async function getLevelApproverIds(tenantId, nivel) {
  if (!nivel) return [];
  const ids = (nivel.aprobadorIds || []).map(String);
  if (nivel.aprobadorTipo === APROBADOR_TIPO.ROL && nivel.rolId) {
    const role = await Role.findOne({ _id: nivel.rolId, tenantId }).lean();
    if (role && (role.permissions || []).includes(PERMISSIONS.REQUISICIONES_APPROVE)) {
      const users = await User.find({ tenantId, roleId: nivel.rolId }).select('_id').lean();
      ids.push(...users.map((u) => String(u._id)));
    }
  }
  return unique(ids);
}

async function getAreaJefeIds(tenantId, areaId) {
  const area = await Area.findOne({ _id: areaId, tenantId }).lean();
  return unique(area?.jefesIds || []);
}

function emitSafe(tenantId, event, params, recipients, excludeUserId) {
  const run = async () => {
    try {
      const builder = REQUISICION_PAYLOAD_BUILDERS[event];
      const payload = builder(params);
      await notificationService.emit(tenantId, event, payload, {
        extraRecipientUserIds: recipients,
        excludeRecipientUserIds: excludeUserId ? [String(excludeUserId)] : [],
      });
    } catch (err) {
      logger.error('requisicion notification failed (ignored)', { tenantId, event, err: String(err) });
    }
  };
  const p = run();
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
}

/**
 * Fires the notification of one transition. Never throws and never rejects.
 *
 * @param {string} tenantId
 * @param {string} event  a `requisicion.*` event name
 * @param {object} req    the (updated) requisition: `_id, consecutivo, areaId, creadaPor, solicitanteId, aprobacion`
 * @param {{ actorId?: string, actorName?: string, nivel?: object, reason?: string, approverLevel?: object }} [ctx]
 *   `nivel`: level shown in the text; `approverLevel`: level whose approvers are notified.
 */
export function notifyRequisicion(tenantId, event, req, ctx = {}) {
  const run = async () => {
    try {
      const people = unique([req.creadaPor, req.solicitanteId]);
      let recipients;
      switch (event) {
        case 'requisicion.submitted':
          recipients = unique([...people, ...(await getAreaJefeIds(tenantId, req.areaId))]);
          break;
        case 'requisicion.approval.requested':
        case 'requisicion.withdrawn':
          recipients = await getLevelApproverIds(tenantId, ctx.approverLevel);
          if (event === 'requisicion.withdrawn') recipients = unique([...recipients, ...people]);
          break;
        case 'requisicion.cancelled':
          recipients = unique([...people, ...(await getLevelApproverIds(tenantId, ctx.approverLevel))]);
          break;
        default: // level.approved, approved, rejected
          recipients = people;
      }
      // Separation of duties: the creator/requester never receive "your approval is requested".
      if (event === 'requisicion.approval.requested') {
        recipients = recipients.filter((id) => !people.includes(id));
      }
      await emitSafe(
        tenantId,
        event,
        {
          requisicionId: req._id,
          consecutivo: req.consecutivo,
          actorName: ctx.actorName,
          nivel: ctx.nivel?.orden,
          reason: ctx.reason,
        },
        recipients,
        ctx.actorId,
      );
    } catch (err) {
      logger.error('requisicion notification failed (ignored)', { tenantId, event, err: String(err) });
    }
  };
  const p = run();
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
}

/** The pending level (if any) of a requisition document. */
export function currentPendingLevel(doc) {
  const niveles = doc?.aprobacion?.niveles || [];
  return niveles.find((n) => n.orden === doc?.aprobacion?.nivelActual && n.estado === NIVEL_ESTADO.PENDIENTE) || null;
}
