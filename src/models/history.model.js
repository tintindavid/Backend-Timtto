'use strict';

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Generic per-tenant activity log. Every operation that mutates a business
 * resource (OT, Report, EquipoItem, Sheet, ...) writes one entry here so the
 * UI can render a timeline for the resource without every service having to
 * carry its own audit table.
 *
 * Conventions:
 *   - resourceType: singular PascalCase model name ('OT', 'Report', 'EquipoItem').
 *   - action: kebab-case verb identifier (create, update, mark-processed,
 *     unprocess, add-nota, sign-worksheet, ...). Keep stable — clients may
 *     filter/style by it.
 *   - description: human-readable Spanish line rendered directly in the UI.
 *   - changes: optional shallow diff `{ field: { from, to } }` — omit for
 *     high-cardinality writes (bulk imports) to keep the collection lean.
 *   - metadata: free-form for action-specific extras (e.g. worksheet id).
 */
const historySchema = new Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    resourceType: { type: String, required: true, trim: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, trim: true, default: 'Sistema' },
    changes: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: 'history',
  },
);

// Primary query: timeline for a specific resource, newest first.
historySchema.index({ tenantId: 1, resourceType: 1, resourceId: 1, createdAt: -1 });
// Secondary: audit browsing (all activity for a tenant, or filtered by action).
historySchema.index({ tenantId: 1, createdAt: -1 });

historySchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const History = model('History', historySchema);
