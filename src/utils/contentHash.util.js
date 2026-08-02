'use strict';
import crypto from 'node:crypto';

/**
 * SHA-256 canonical hash for a signed batch of reports. Sorts by _id string,
 * serializes [{ id, updatedAt: ISO }] as JSON, hashes. Used to detect edits
 * to reports after they were signed by the client (design D7).
 *
 * @param {Array<{ _id: any, updatedAt: Date | string }>} reports
 * @returns {string} hex-encoded SHA-256 digest
 */
export function computeSignedContentHash(reports) {
  const canonical = JSON.stringify(
    (reports || [])
      .map((r) => ({ id: String(r._id), updatedAt: new Date(r.updatedAt).toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
