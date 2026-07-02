import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Action enum for platform audit events.
 * All values are UPPER_SNAKE_CASE as per domain constants convention.
 */
export const PLATFORM_AUDIT_ACTIONS = [
  'TENANT_CREATED',
  'TENANT_UPDATED',
  'TENANT_SUSPENDED',
  'TENANT_REACTIVATED',
  'TENANT_SOFT_DELETED',
  'USER_PASSWORD_RESET',
  'VIEW_AS_ENTERED',
  'VIEW_AS_EXITED',
];

/**
 * PlatformAuditLog — immutable event log for SuperAdmin platform actions.
 *
 * Design decisions:
 * - No isDeleted / soft-delete: these records are immutable by design (constitution E2-D4).
 * - No timestamps: uses its own `timestamp` field with TTL index (2 years).
 * - No tenantId: records span all tenants (platform-level, not tenant-scoped).
 * - TTL index on `timestamp` (expireAfterSeconds: 63072000 ≈ 2 years).
 */
const platformAuditLogSchema = new Schema(
  {
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorEmail: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: PLATFORM_AUDIT_ACTIONS,
    },
    targetType: {
      type: String,
      enum: ['tenant', 'user'],
    },
    /** MongoDB _id of the affected document (tenant or user). */
    targetId: {
      type: Schema.Types.ObjectId,
    },
    /** String tenantId (e.g. 'clinica-abc') of the affected tenant. */
    targetTenantId: {
      type: String,
    },
    /** Snapshot of the document state BEFORE the action (null for creates). */
    before: {
      type: Schema.Types.Mixed,
    },
    /** Snapshot of the document state AFTER the action. */
    after: {
      type: Schema.Types.Mixed,
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    timestamp: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    versionKey: false,
    timestamps: false,
    collection: 'platformauditlogs',
  },
);

// TTL: auto-expire after 2 years (63072000 s).
// Note: MongoDB TTL monitors run every ~60 s; expiry is approximate.
platformAuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 });

// Compound indexes for the two primary query patterns (actor and target).
platformAuditLogSchema.index({ actorUserId: 1, timestamp: -1 });
platformAuditLogSchema.index({ targetTenantId: 1, timestamp: -1 });

// Standalone index for action filtering.
platformAuditLogSchema.index({ action: 1, timestamp: -1 });

export const PlatformAuditLog = model('PlatformAuditLog', platformAuditLogSchema);
