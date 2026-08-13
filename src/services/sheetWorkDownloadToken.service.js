'use strict';
import { nanoid } from 'nanoid';
import { SheetWorkDownloadToken } from '../models/sheetWorkDownloadToken.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import {
  SHEET_SHARE_TOKEN_LENGTH,
  SHEET_SHARE_DOWNLOAD_TTL_MS,
  SHEET_SHARE_HT_DOWNLOADS_ALLOWED,
  SHEET_SHARE_REPORTS_DOWNLOADS_ALLOWED,
} from '../constants/sheetwork.constants.js';

const MAX_NANOID_RETRIES = 3;

async function generateUniqueTokenString() {
  for (let attempt = 0; attempt < MAX_NANOID_RETRIES; attempt += 1) {
    const candidate = nanoid(SHEET_SHARE_TOKEN_LENGTH);
    const collision = await SheetWorkDownloadToken.findOne({ token: candidate })
      .select('_id')
      .setOptions({ includeDeleted: true })
      .lean();
    if (!collision) return candidate;
    logger.warn('SheetWorkDownloadToken: nanoid collision — retrying', { attempt });
  }
  throw new ApiError(500, 'No fue posible generar un token único', 'TOKEN_GENERATION_FAILED');
}

export class SheetWorkDownloadTokenService {
  /**
   * Upserts a fresh share token on the sheet — previous URL 404s. Counters
   * reset to 0.
   */
  async createForSheet({ tenantId, sheetId, otId, clienteId, email, issuedBy, allowReports }) {
    const token = await generateUniqueTokenString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHEET_SHARE_DOWNLOAD_TTL_MS);
    const allow = Boolean(allowReports);

    const doc = await SheetWorkDownloadToken.findOneAndUpdate(
      { sheetId },
      {
        $set: {
          tenantId,
          sheetId,
          otId,
          clienteId,
          email: String(email || '').toLowerCase().trim(),
          token,
          expiresAt,
          status: 'active',
          downloadsAllowed: SHEET_SHARE_HT_DOWNLOADS_ALLOWED,
          downloadsUsed: 0,
          allowReports: allow,
          reportDownloadsAllowed: allow ? SHEET_SHARE_REPORTS_DOWNLOADS_ALLOWED : 0,
          reportDownloadsUsed: 0,
          issuedBy,
          issuedAt: now,
          revokedAt: null,
          revokedBy: null,
          isDeleted: false,
          deletedAt: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return doc;
  }

  /**
   * Returns:
   *   - null                     — unknown / soft-deleted
   *   - { status: 'expired', doc }   — expiresAt <= now (auto-flipped on read)
   *   - { status: 'revoked', doc }
   *   - { status: 'exhausted', doc } — HT downloads used up
   *   - { status: 'active', doc }
   */
  async resolveByToken(token) {
    if (!token || typeof token !== 'string') return null;

    const doc = await SheetWorkDownloadToken.findOne({ token }).setOptions({ includeDeleted: true });
    if (!doc || doc.isDeleted) return null;

    if (doc.status === 'revoked') return { status: 'revoked', doc };

    const now = new Date();
    if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) {
      if (doc.status !== 'expired') {
        try {
          await SheetWorkDownloadToken.updateOne({ _id: doc._id }, { $set: { status: 'expired' } });
          doc.status = 'expired';
        } catch (err) {
          logger.warn('SheetWorkDownloadToken: failed to flip status to expired', {
            tokenId: String(doc._id),
            err: String(err),
          });
        }
      }
      return { status: 'expired', doc };
    }

    if (doc.status === 'exhausted') return { status: 'exhausted', doc };
    return { status: 'active', doc };
  }

  /**
   * Atomically increments `downloadsUsed` only if there are downloads left.
   * Returns `{ ok: true, doc }` when the increment happened, `{ ok: false }`
   * when the quota was already full (caller responds 410).
   */
  async incrementHtDownload(id) {
    const doc = await SheetWorkDownloadToken.findOneAndUpdate(
      {
        _id: id,
        status: 'active',
        $expr: { $lt: ['$downloadsUsed', '$downloadsAllowed'] },
      },
      { $inc: { downloadsUsed: 1 } },
      { new: true }
    );
    if (!doc) return { ok: false };
    if (doc.downloadsUsed >= doc.downloadsAllowed) {
      await SheetWorkDownloadToken.updateOne(
        { _id: doc._id, status: 'active' },
        { $set: { status: 'exhausted' } }
      ).catch(() => {});
      doc.status = 'exhausted';
    }
    return { ok: true, doc };
  }

  async incrementReportDownload(id) {
    const doc = await SheetWorkDownloadToken.findOneAndUpdate(
      {
        _id: id,
        status: 'active',
        allowReports: true,
        $expr: { $lt: ['$reportDownloadsUsed', '$reportDownloadsAllowed'] },
      },
      { $inc: { reportDownloadsUsed: 1 } },
      { new: true }
    );
    if (!doc) return { ok: false };
    return { ok: true, doc };
  }
}

export const sheetWorkDownloadTokenService = new SheetWorkDownloadTokenService();
