'use strict';
import { sheetWorkDownloadTokenService } from '../services/sheetWorkDownloadToken.service.js';
import { logger } from '../config/logger.config.js';

/**
 * resolveSheetDownloadToken — gate for /public/sheet-download/:token/*.
 * Mirrors the resolveSheetSignToken pattern but recognizes the additional
 * `exhausted` state (all HT downloads used up).
 *
 * Responses:
 *   404 { error: 'token_not_found' }
 *   410 { error: 'token_expired' | 'token_revoked' | 'download_exhausted' }
 *   next()  — active
 */
export async function resolveSheetDownloadToken(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store, private');
    const token = req.params.token;
    if (!token || typeof token !== 'string') {
      return res.status(404).json({ error: 'token_not_found' });
    }
    const resolved = await sheetWorkDownloadTokenService.resolveByToken(token);
    if (!resolved) {
      return res.status(404).json({ error: 'token_not_found' });
    }
    if (resolved.status === 'expired') return res.status(410).json({ error: 'token_expired' });
    if (resolved.status === 'revoked') return res.status(410).json({ error: 'token_revoked' });
    if (resolved.status === 'exhausted') return res.status(410).json({ error: 'download_exhausted' });

    req.downloadToken = resolved.doc;
    req.tenantId = String(resolved.doc.tenantId);
    return next();
  } catch (err) {
    logger.error('resolveSheetDownloadToken: unexpected error', { err: String(err) });
    return next(err);
  }
}
