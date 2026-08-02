'use strict';
import { ClientAccessToken } from '../models/clientAccessToken.model.js';
import { logger } from '../config/logger.config.js';

/**
 * resolveClientToken — public-portal analog of publicAuth.middleware.js.
 *
 * Resolves the opaque nanoid token from `req.params.token`, validates it
 * exists, is `active` and not soft-deleted, and injects:
 *   req.tenantId, req.clienteId, req.otIds, req.tokenId, req.clientAccessToken
 *
 * Unlike publicAuth (JWT sessionToken + password rotation), there is no
 * signature to verify and no session — the nanoid IS the credential
 * (design D2). Every downstream query MUST use req.tenantId from here,
 * never a header or cookie.
 *
 * Response bodies for 404/410 are intentionally NOT the standard
 * ApiError/errorHandler envelope — the spec mandates the literal shapes
 * `{ error: 'token_not_found' }` and `{ error: 'token_revoked', revokedAt }`.
 */
export async function resolveClientToken(req, res, next) {
  try {
    // The controller sets this on 200; short-circuit responses below skip
    // the controller, so set it here to keep every public-portal response
    // consistent with the spec (security-auditor Finding 3).
    res.set('Cache-Control', 'no-store, private');

    const token = req.params.token;
    if (!token || typeof token !== 'string') {
      return res.status(404).json({ error: 'token_not_found' });
    }

    const doc = await ClientAccessToken.findOne({ token }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'token_not_found' });
    }

    if (doc.status === 'revoked') {
      return res.status(410).json({ error: 'token_revoked', revokedAt: doc.revokedAt });
    }

    req.tenantId = String(doc.tenantId);
    req.clienteId = String(doc.clienteId);
    req.otIds = (doc.otIds || []).map((id) => String(id));
    req.tokenId = String(doc._id);
    req.clientAccessToken = {
      tokenId: req.tokenId,
      clienteId: req.clienteId,
      otIds: req.otIds,
    };

    // Best-effort async counters (design D5) — never await, never block the response.
    ClientAccessToken.updateOne(
      { _id: doc._id },
      { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } }
    )
      .exec()
      .catch((err) => {
        logger.warn('resolveClientToken: failed to update access counters', {
          tokenId: req.tokenId,
          err: String(err),
        });
      });

    return next();
  } catch (err) {
    return next(err);
  }
}
