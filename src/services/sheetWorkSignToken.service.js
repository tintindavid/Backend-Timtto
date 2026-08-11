'use strict';
import { nanoid } from 'nanoid';
import { SheetWorkSignToken } from '../models/sheetWorkSignToken.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import {
  SHEET_SIGN_TOKEN_LENGTH,
  SHEET_SIGN_TOKEN_TTL_MS,
} from '../constants/sheetwork.constants.js';

const MAX_NANOID_RETRIES = 3;

async function generateUniqueTokenString() {
  for (let attempt = 0; attempt < MAX_NANOID_RETRIES; attempt += 1) {
    const candidate = nanoid(SHEET_SIGN_TOKEN_LENGTH);
    const collision = await SheetWorkSignToken.findOne({ token: candidate })
      .select('_id')
      .setOptions({ includeDeleted: true })
      .lean();
    if (!collision) return candidate;
    logger.warn('SheetWorkSignToken: nanoid collision — retrying', { attempt });
  }
  throw new ApiError(500, 'No fue posible generar un token único', 'TOKEN_GENERATION_FAILED');
}

export class SheetWorkSignTokenService {
  /**
   * Creates or replaces the token for a sheet. Upserts on `sheetId` so a
   * resend after expiration replaces the previous doc atomically instead of
   * hitting the unique-index on `sheetId`.
   */
  async createForSheet({ tenantId, sheetId, otId, clienteId, email, requestedBy, message }) {
    const token = await generateUniqueTokenString();
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + SHEET_SIGN_TOKEN_TTL_MS);

    const doc = await SheetWorkSignToken.findOneAndUpdate(
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
          requestedBy,
          requestedAt,
          message: message || null,
          resendCount: 0,
          signedAt: null,
          signedIp: null,
          signedUserAgent: null,
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
   * Resolves a token by its opaque string. Returns:
   *   - `{ status: 'active' | 'signed', doc }` for usable tokens
   *   - `{ status: 'expired' | 'revoked' | 'superseded' }` for dead tokens
   *   - `null` for unknown tokens (no existence leak — caller responds 404)
   */
  async resolveByToken(token) {
    if (!token || typeof token !== 'string') return null;

    const doc = await SheetWorkSignToken.findOne({ token }).setOptions({ includeDeleted: true });
    if (!doc || doc.isDeleted) return null;

    if (doc.status === 'revoked') return { status: 'revoked', doc };
    if (doc.status === 'superseded') return { status: 'superseded', doc };

    const now = new Date();
    if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) {
      if (doc.status !== 'expired') {
        try {
          await SheetWorkSignToken.updateOne({ _id: doc._id }, { $set: { status: 'expired' } });
          doc.status = 'expired';
        } catch (err) {
          logger.warn('SheetWorkSignToken: failed to flip status to expired', {
            tokenId: String(doc._id),
            err: String(err),
          });
        }
      }
      return { status: 'expired', doc };
    }

    if (doc.status === 'signed') return { status: 'signed', doc };
    return { status: 'active', doc };
  }

  /**
   * Renews `expiresAt` to `signedAt + 7d` and flips status to `signed`.
   * Called from the public sign service after the sheet was closed.
   */
  async renewOnSign(tokenId, signedAt, meta = {}) {
    const newExpires = new Date(signedAt.getTime() + SHEET_SIGN_TOKEN_TTL_MS);
    await SheetWorkSignToken.updateOne(
      { _id: tokenId },
      {
        $set: {
          status: 'signed',
          expiresAt: newExpires,
          signedAt,
          signedIp: meta.ip || null,
          signedUserAgent: meta.userAgent || null,
        },
      }
    );
    return { expiresAt: newExpires };
  }

  /** Called from the in-place fallback when the admin signs on-site. */
  async markSuperseded(sheetId, userId = null) {
    const now = new Date();
    await SheetWorkSignToken.updateOne(
      { sheetId, status: { $in: ['active', 'signed'] } },
      {
        $set: {
          status: 'superseded',
          expiresAt: now,
          revokedAt: now,
          revokedBy: userId,
        },
      }
    );
  }

  async incrementResendCount(tokenId) {
    await SheetWorkSignToken.updateOne({ _id: tokenId }, { $inc: { resendCount: 1 } });
  }

  async updateEmail(tokenId, email) {
    await SheetWorkSignToken.updateOne(
      { _id: tokenId },
      { $set: { email: String(email || '').toLowerCase().trim() } }
    );
  }
}

export const sheetWorkSignTokenService = new SheetWorkSignTokenService();
