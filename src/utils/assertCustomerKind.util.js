'use strict';

import mongoose from 'mongoose';
import { Customer } from '../models/customer.model.js';
import { ApiError } from './apiError.util.js';
import { applyTenantFilter } from './tenant.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Throws 400 INVALID_CUSTOMER_KIND when `customer` is a provider. Legacy
 * documents without `kind` count as customers. Shared by assertCustomerKind
 * and by callers that already loaded the document (e.g. serviceQr scope).
 */
export function assertIsCustomer(customer, tenantId) {
  if (customer && customer.kind === 'provider') {
    logger.warn('assertCustomerKind: provider rejected as ClienteId', {
      tenantId,
      customerId: String(customer._id),
    });
    throw new ApiError(
      400,
      'Un proveedor no puede usarse como cliente',
      'INVALID_CUSTOMER_KIND',
      { customerId: String(customer._id) },
    );
  }
}

/**
 * Verifies that `customerId` is a third party of the tenant that is NOT a
 * provider. Used by every write path that sets `ClienteId` / `clienteId`
 * (terceros-customers-providers, design decision 5).
 *
 * - No id supplied: no-op, returns null (callers keep their own required checks).
 * - Not found in the tenant (or invalid ObjectId): 404 CUSTOMER_NOT_FOUND.
 * - Provider: 400 INVALID_CUSTOMER_KIND.
 *
 * @param {string} customerId
 * @param {string} tenantId
 * @returns {Promise<object|null>} the lean customer ({ _id, kind })
 */
export async function assertCustomerKind(customerId, tenantId) {
  if (!customerId) return null;

  if (!mongoose.isValidObjectId(customerId)) {
    logger.warn('assertCustomerKind: invalid customer id', { tenantId, customerId: String(customerId) });
    throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND', { customerId: String(customerId) });
  }

  const customer = await Customer.findOne(applyTenantFilter({ _id: customerId }, tenantId))
    .select('_id kind')
    .lean();

  if (!customer) {
    logger.warn('assertCustomerKind: customer not found in tenant', { tenantId, customerId: String(customerId) });
    throw new ApiError(404, 'Cliente no encontrado', 'CUSTOMER_NOT_FOUND', { customerId: String(customerId) });
  }

  assertIsCustomer(customer, tenantId);
  return customer;
}

/**
 * Update-path variant: validates only when the client actually changes. Editing a
 * record that keeps its current `ClienteId` must keep working even if that client
 * was soft-deleted later (the Customer find hook hides deleted documents).
 */
export async function assertCustomerKindIfChanged(customerId, currentCustomerId, tenantId) {
  if (!customerId) return null;
  if (currentCustomerId && String(customerId) === String(currentCustomerId)) return null;
  return assertCustomerKind(customerId, tenantId);
}

/**
 * Verifies that `providerId` is a non-deleted third party of the tenant with kind 'provider'.
 * Mirror of assertCustomerKind (external activities reference providers, never clients).
 *
 * - No id supplied: no-op, returns null.
 * - Invalid id, other tenant or soft-deleted: 404 CUSTOMER_NOT_FOUND.
 * - kind 'customer' (or legacy documents without kind): 400 INVALID_PROVIDER.
 *
 * @param {string} providerId
 * @param {string} tenantId
 * @returns {Promise<object|null>} the lean provider ({ _id, kind, Razonsocial })
 */
export async function assertCustomerIsProvider(providerId, tenantId) {
  if (!providerId) return null;

  if (!mongoose.isValidObjectId(providerId)) {
    logger.warn('assertCustomerIsProvider: invalid provider id', { tenantId, providerId: String(providerId) });
    throw new ApiError(404, 'Proveedor no encontrado', 'CUSTOMER_NOT_FOUND', { customerId: String(providerId) });
  }

  const provider = await Customer.findOne(applyTenantFilter({ _id: providerId }, tenantId))
    .select('_id kind Razonsocial')
    .lean();

  if (!provider) {
    logger.warn('assertCustomerIsProvider: provider not found in tenant', { tenantId, providerId: String(providerId) });
    throw new ApiError(404, 'Proveedor no encontrado', 'CUSTOMER_NOT_FOUND', { customerId: String(providerId) });
  }

  if (provider.kind !== 'provider') {
    logger.warn('assertCustomerIsProvider: client rejected as provider', { tenantId, customerId: String(provider._id) });
    throw new ApiError(400, 'El tercero seleccionado no es un proveedor', 'INVALID_PROVIDER', { customerId: String(provider._id) });
  }
  return provider;
}
