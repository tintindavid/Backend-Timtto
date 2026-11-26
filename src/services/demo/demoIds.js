import crypto from 'node:crypto';
import mongoose from 'mongoose';

/**
 * Deterministic _id of a sample record of ONE tenant: links are rewritten to the tenant's own copies and re-running
 * the seed only inserts what is missing.
 */
export function demoId(tenantId, key) {
  const hex = crypto.createHash('sha256').update(`${tenantId}:${key}`).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}
