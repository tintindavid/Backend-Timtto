import crypto from 'node:crypto';
import { DemoLock } from '../../models/demoLock.model.js';
import { User } from '../../models/user.model.js';
import { Customer } from '../../models/customer.model.js';
import { EquipoItem } from '../../models/equipoitem.model.js';
import { ApiError } from '../../utils/apiError.util.js';
import { requireTenant } from '../../utils/tenant.util.js';
import { getDemoConfig } from './demoContext.service.js';

const LOCK_TTL_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_ATTEMPTS = 200;

const LABELS = { users: 'usuarios', customers: 'clientes', equipos: 'equipos' };

const COUNTERS = {
  users: (tenantId) => User.countDocuments({ tenantId, isDeleted: false }),
  customers: (tenantId) => Customer.countDocuments({ tenantId, isDeleted: false, kind: { $ne: 'provider' } }),
  equipos: (tenantId) => EquipoItem.countDocuments({ tenantId, isDeleted: false }),
};

/** Runs `work` holding the (tenant, resource) lock. */
export async function withDemoLock(tenantId, resource, work, { ttlMs = LOCK_TTL_MS, attempts = LOCK_ATTEMPTS } = {}) {
  requireTenant(tenantId);
  const owner = crypto.randomUUID();
  for (let attempt = 0; ; attempt += 1) {
    try {
      await DemoLock.create({ tenantId, resource, owner, expiresAt: new Date(Date.now() + ttlMs) });
      break;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // The TTL monitor runs once a minute: drop an expired lock ourselves.
      const stale = await DemoLock.deleteOne({ tenantId, resource, expiresAt: { $lt: new Date() } });
      if (attempt >= attempts && !stale?.deletedCount) {
        throw new ApiError(409, 'Hay otra operación en curso, intenta de nuevo', 'DEMO_BUSY', { resource });
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  try {
    return await work();
  } finally {
    await DemoLock.deleteOne({ tenantId, resource, owner });
  }
}

/** Current usage of the limited resources of a tenant. */
export async function getDemoUsage(tenantId) {
  requireTenant(tenantId);
  const [users, customers, equipos] = await Promise.all(
    ['users', 'customers', 'equipos'].map((resource) => COUNTERS[resource](tenantId)),
  );
  return { users, customers, equipos };
}

/**
 * Runs `work` (which creates `amount` records of `resource`) only if the demo limit allows it.
 * Outside a demo account it just runs `work`.
 */
export async function withDemoQuota(tenantId, resource, amount, work) {
  if (amount <= 0) return work();
  const demo = await getDemoConfig(tenantId);
  if (!demo) return work();
  return withDemoLock(tenantId, resource, async () => {
    const limit = demo.limits[resource];
    const used = await COUNTERS[resource](tenantId);
    if (used + amount > limit) {
      throw new ApiError(
        403,
        `Las cuentas de demostración permiten máximo ${limit} ${LABELS[resource]}`,
        'DEMO_LIMIT_REACHED',
        { resource, limit, used },
      );
    }
    return work();
  });
}
