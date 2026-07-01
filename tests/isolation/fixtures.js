/**
 * tests/isolation/fixtures.js
 *
 * Factory helpers for isolation tests.
 *
 * These factories build in-memory stubs that exercise the service layer
 * without a real MongoDB connection. They simulate the result objects
 * returned by Mongoose .lean() so that isolation contracts can be verified
 * by inspecting which tenantId was passed to each query.
 *
 * Note: integration tests against a real test DB would additionally call
 * createTenantWithUser to provision real documents. Those are marked below
 * for future upgrade when a test MongoDB URI is available.
 */

import { signToken } from '../../src/utils/jwt.util.js';

/**
 * Returns a synthetic { tenant, user, token } triple.
 * The token is a valid signed JWT with { userId, role, tenantId }.
 */
export function createTenantWithUser({ tenantId, adminEmail, role = 'admin' }) {
  const userId = `user-${tenantId}`;
  const tenant = { tenantId, name: `Tenant ${tenantId}`, status: 'active' };
  const user = { _id: userId, userId, tenantId, email: adminEmail, role };
  const token = signToken({ userId, role, tenantId });
  return { tenant, user, token };
}

/**
 * Returns a synthetic customer document for a given tenant.
 */
export function seedCustomerFor(tenantId) {
  return {
    _id: `customer-${tenantId}`,
    tenantId,
    Razonsocial: `Cliente de ${tenantId}`,
    Ciudad: 'Bogotá',
    Departamento: 'Cundinamarca',
    Email: `cliente@${tenantId}.com`,
    Nit: Math.floor(Math.random() * 1_000_000),
    isDeleted: false,
  };
}

/**
 * Returns a synthetic equipoitem document for a given tenant.
 */
export function seedEquipoFor(tenantId) {
  return {
    _id: `equipo-${tenantId}`,
    tenantId,
    Estado: 'Activo',
    Marca: 'Marca Test',
    Serie: `SN-${tenantId}`,
    isDeleted: false,
  };
}

/**
 * Returns a synthetic OT document for a given tenant.
 */
export function seedOTFor(tenantId) {
  return {
    _id: `ot-${tenantId}`,
    tenantId,
    Consecutivo: `OT000001`,
    EstadoOt: 'Abierta',
    isDeleted: false,
  };
}

/**
 * Returns a synthetic report document for a given tenant.
 */
export function seedReportFor(tenantId) {
  return {
    _id: `report-${tenantId}`,
    tenantId,
    consecutivo: `R000001`,
    isDeleted: false,
  };
}

/**
 * Returns a synthetic user document for a given tenant.
 */
export function seedUserFor(tenantId) {
  return {
    _id: `extra-user-${tenantId}`,
    tenantId,
    email: `extra@${tenantId}.com`,
    role: 'technician',
    isDeleted: false,
  };
}
