import { Tenant } from '../../models/tenant.model.js';
import { ApiError } from '../../utils/apiError.util.js';

/** Lookup seam: DB-free tests of other modules replace it (tests/helpers/noDemoAccounts.js). */
export const demoLookup = {
  find: (tenantId) => Tenant.findOne({ tenantId }, { tenantId: 1, demo: 1 }).lean(),
};

/** Demo configuration of a tenant, or null when it is not a demo account. */
export async function getDemoConfig(tenantId) {
  if (!tenantId) return null;
  const tenant = await demoLookup.find(tenantId);
  return tenant?.demo?.enabled === true ? tenant.demo : null;
}

/** Throws 403 DEMO_FEATURE_BLOCKED when the tenant is a demo account. */
export async function assertNotDemo(tenantId, feature) {
  if (await getDemoConfig(tenantId)) {
    throw new ApiError(403, 'No disponible en cuentas de demostración', 'DEMO_FEATURE_BLOCKED', { feature });
  }
}

/** Route middleware form of assertNotDemo; place it after authorize(). */
export function blockInDemo(feature, when = () => true) {
  const guard = (req, _res, next) => {
    if (!when(req)) return next();
    return assertNotDemo(req.tenantId, feature).then(() => next(), next);
  };
  guard.demoFeature = feature;
  return guard;
}
