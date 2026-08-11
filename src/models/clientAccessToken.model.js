'use strict';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * ClientAccessToken — opaque nanoid(32) link that grants a client read-only
 * access to one or more OTs (all belonging to the same Customer) and their
 * reports, without login. No time-based expiration — only manual revoke.
 *
 * Design references (openspec/changes/client-portal-token-and-readonly/design.md):
 *  - D1: opaque nanoid(32) token, stored in clear, unique index (no hashing)
 *  - D6: createdBy must have User.fileFirma (enforced in the service layer,
 *        not here — fail-fast prerequisite for the follow-up signature change)
 *  - D13: collection `client_access_tokens`, model `ClientAccessToken`
 *
 * Cross-check of `otIds` belonging to `clienteId`:
 *   The authoritative check (with a DB round-trip) lives in
 *   clientAccessToken.service.js#create (a single `OT.find` query), because
 *   Mongoose schema hooks should stay DB-query-free and synchronously
 *   testable. To still give the model an enforceable invariant (per task 1.2)
 *   without duplicating I/O, the service assigns the resolved `ClienteId` of
 *   each fetched OT to the transient virtual `otClienteIds` before `.save()`.
 *   `pre('validate')` then performs a synchronous, DB-free comparison against
 *   `this.clienteId`. If the virtual is never set (e.g. a direct write that
 *   bypasses the service), no cross-check runs — the service is the source of
 *   truth; this hook is a defensive belt for callers who do set it.
 */
const ClientAccessTokenSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    clienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    otIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'OT' }],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'otIds must contain at least one OT',
      },
    },

    token: { type: String, required: true, trim: true },

    status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },

    // Audit counters (best-effort, updated async by resolveClientToken — D5).
    accessCount: { type: Number, default: 0 },
    lastAccessedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    /* User whose signature will appear on every HT auto-generated from this
       token (2026-08-03). Immutable after creation. Defaults to createdBy
       when the request body omits it; the create-time DTO validates that
       this user has User.fileFirma. Optional (not required) so legacy
       tokens created before this field existed still load — the sign
       flow falls back to createdBy when null. */
    attributionUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /* Send-link audit trail (client-token-edit-and-send). Absent on legacy
       tokens. Single-record subdoc (D3): the UI only needs "N envíos, último
       a x@y.com el <fecha>" — no need for a full array. */
    emailHistory: {
      lastEmail: { type: String, trim: true, lowercase: true, default: null },
      lastSentAt: { type: Date, default: null },
      lastSentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      sendCount: { type: Number, default: 0 },
    },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Soft delete & audit
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'client_access_tokens',
  }
);

// ---------- Virtuals ----------
// Transient, non-persisted field set by the service right before `.save()`
// so `pre('validate')` can cross-check otIds->clienteId without a DB query.
ClientAccessTokenSchema.virtual('otClienteIds')
  .set(function (arr) {
    this._otClienteIds = arr;
  })
  .get(function () {
    return this._otClienteIds;
  });

// ---------- Indexes ----------
ClientAccessTokenSchema.index({ token: 1 }, { unique: true });
ClientAccessTokenSchema.index({ tenantId: 1, clienteId: 1, status: 1, isDeleted: 1 });
ClientAccessTokenSchema.index({ tenantId: 1, createdAt: -1 });

// ---------- Hooks ----------
ClientAccessTokenSchema.pre('validate', function (next) {
  if (Array.isArray(this._otClienteIds) && this._otClienteIds.length) {
    const mismatch = this._otClienteIds.some(
      (cid) => String(cid) !== String(this.clienteId)
    );
    if (mismatch) {
      return next(new Error('OT_CLIENT_MISMATCH'));
    }
  }
  next();
});

// Default query excludes soft-deleted; pass { includeDeleted: true } via
// .setOptions() to opt out.
ClientAccessTokenSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

// Exclude internal/sensitive fields from JSON output.
ClientAccessTokenSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

export const ClientAccessToken = model('ClientAccessToken', ClientAccessTokenSchema);
