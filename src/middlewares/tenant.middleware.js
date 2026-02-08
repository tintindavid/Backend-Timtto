'use strict';
import { ApiError } from '../utils/apiError.util.js';
import { Tenant } from '../models/tenant.model.js';
import mongoose from 'mongoose';
import { logger } from '../config/logger.config.js';

/**
 * Resolve tenantId for the request and validate it exists.
 * Priority: header 'x-tenant-id' -> req.user?.tenantId -> body.tenantId
 * Sets req.tenantId when found.
 */
export async function tenantResolver(req, res, next) {
  try {
    const header = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'];
    let tenantId = null;
    if (header && typeof header === 'string' && header.trim()) {
      tenantId = header.trim();
    } else if (req.user && req.user.tenantId) {
      tenantId = req.user.tenantId;
    } else if (req.body && req.body.tenantId) {
      tenantId = req.body.tenantId;
    }

    if (!tenantId) {
      logger.debug && logger.debug('tenantResolver: no tenantId provided');
      return next();
    }

    // allow tenant creation endpoint to pass without existing tenant
    if (req.method === 'POST' && req.path === '/api/v1/tenants') {
      req.tenantId = tenantId;
      return next();
    }

    // Búsqueda case-insensitive
    logger.info('tenantResolver: resolving tenantId', { tenantId });
    // additional debug: show raw representation and length
    try {
      logger.debug && logger.debug('tenantResolver: tenantId debug', { raw: tenantId, len: (tenantId || '').length, repr: JSON.stringify(tenantId) });
    } catch (e) {
      // ignore
    }

    // avoid heavy queries that may cause network issues; get a lightweight count instead
    try {
      const total = await Tenant.countDocuments();
      logger.info('tenantResolver: total tenants in DB', { count: total });
    } catch (countErr) {
      logger.debug && logger.debug('tenantResolver: tenant count failed', { err: String(countErr) });
    }

    // Raw DB inspection: list collections and raw collection counts to detect mismatches
    try {
      const db = mongoose.connection.db;
      const cols = await db.listCollections().toArray();
      logger.info('tenantResolver: db collections', { names: cols.map((c) => c.name) });
      try {
        const rawCount = await db.collection('tenants').countDocuments();
        logger.info('tenantResolver: raw tenants count', { rawCount });
        const sample = await db.collection('tenants').findOne({}, { projection: { tenantId: 1, isDeleted: 1, name: 1 } });
        logger.info('tenantResolver: tenants sample (raw)', { sample });
      } catch (rawErr) {
        logger.debug && logger.debug('tenantResolver: raw tenants collection inspection failed', { err: String(rawErr) });
      }
    } catch (dbErr) {
      logger.debug && logger.debug('tenantResolver: db listCollections failed', { err: String(dbErr) });
    }
    const exists = await Tenant.exists({
      tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') },
      isDeleted: false,
    });

    logger.info('tenantResolver: exists?', { tenantId, exists: Boolean(exists) });
    // If not found, attempt a looser find to inspect possible matches (for debugging only)
    if (!exists) {
      try {
        const candidate = await Tenant.findOne({ tenantId: { $regex: new RegExp(`${tenantId}`, 'i') } }).select('tenantId isDeleted name').lean();
        logger.info('tenantResolver: candidate lookup', { tenantId, candidate: candidate ? { tenantId: candidate.tenantId, isDeleted: candidate.isDeleted, name: candidate.name } : null });
      } catch (dbgErr) {
        logger.debug && logger.debug('tenantResolver: candidate lookup failed', { err: String(dbgErr) });
      }
    }
    if (!exists) return next(new ApiError(404, 'Tenant not found', 'TENANT_NOT_FOUND'));
    req.tenantId = tenantId;
    return next();
  } catch (err) {
    return next(new ApiError(400, 'Tenant resolution failed', 'TENANT_RESOLUTION_FAILED'));
  }
}
