'use strict';
import { sheetWorkSignTokenService } from '../services/sheetWorkSignToken.service.js';
import { logger } from '../config/logger.config.js';

/**
 * resolveSheetSignToken — public-endpoint gate for /public/sheet-sign/:token.
 * Mirrors the resolveClientToken pattern but scoped to a single SheetWork.
 *
 * Responses:
 *   404 { error: 'token_not_found' }               — unknown token (no leak)
 *   410 { error: 'token_expired'|'token_revoked'|'token_superseded' } — dead
 *   next()                                          — active OR signed (both
 *     usable, controller decides the view)
 */
export async function resolveSheetSignToken(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store, private');
    const token = req.params.token;
    if (!token || typeof token !== 'string') {
      return res.status(404).json({ error: 'token_not_found' });
    }
    const resolved = await sheetWorkSignTokenService.resolveByToken(token);
    if (!resolved) {
      return res.status(404).json({ error: 'token_not_found' });
    }
    if (resolved.status === 'expired') {
      return res.status(410).json({ error: 'token_expired' });
    }
    if (resolved.status === 'revoked') {
      return res.status(410).json({ error: 'token_revoked', revokedAt: resolved.doc.revokedAt });
    }
    if (resolved.status === 'superseded') {
      return res.status(410).json({ error: 'token_superseded' });
    }
    req.sheetSignToken = {
      tokenId: String(resolved.doc._id),
      token: resolved.doc.token,
      tenantId: String(resolved.doc.tenantId),
      sheetId: String(resolved.doc.sheetId),
      status: resolved.status,
      expiresAt: resolved.doc.expiresAt,
    };
    req.tenantId = String(resolved.doc.tenantId);
    return next();
  } catch (err) {
    logger.error('resolveSheetSignToken: unexpected error', { err: String(err) });
    return next(err);
  }
}
