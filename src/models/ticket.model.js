'use strict';
import mongoose from 'mongoose';
import {
  TICKET_STATUS,
  TICKET_STATUS_VALUES,
  TICKET_URGENCY_VALUES,
  TICKET_SOURCE_VALUES,
  TICKET_CLOSING_REASON_VALUES,
  TICKET_OBSERVATION_MAX_LENGTH,
} from '../constants/ticket.constants.js';

const { Schema, model } = mongoose;

/**
 * Equipo snapshot embedded in the ticket so the public list can render
 * even after the equipo is soft-deleted (design D20 keeps in-flight tickets
 * historically intact).
 */
const EquipoSnapshotSchema = new Schema(
  {
    nombre: { type: String, trim: true, default: '' },
    marca: { type: String, trim: true, default: '' },
    modelo: { type: String, trim: true, default: '' },
    serie: { type: String, trim: true, default: '' },
    inventario: { type: String, trim: true, default: '' },
    ubicacion: { type: String, trim: true, default: '' },
    servicio: { type: String, trim: true, default: '' },
    sede: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/**
 * Single requestor descriptor — captured per-ticket so the public flow can
 * raise multiple tickets in a single batch with the SAME requester (typical),
 * but admin-created tickets can still record the panel user as requester.
 */
const RequestedBySchema = new Schema(
  {
    name: { type: String, trim: true, required: true },
    position: { type: String, trim: true, required: true },
  },
  { _id: false }
);

/**
 * Internal note appended via POST /api/tickets/:id/note. Immutable after
 * creation per requirement spec.
 */
const InternalNoteSchema = new Schema(
  {
    note: { type: String, trim: true, required: true, maxlength: 1000 },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const TicketSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },

    // Consecutivo per (tenant, year): TKT-{YYYY}-{NNNN}
    consecutivo: { type: String, required: true, trim: true },

    // Existing-collection references keep their original field names (D3).
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    sedeId: { type: Schema.Types.ObjectId, ref: 'Sedes', required: true },
    servicioId: { type: Schema.Types.ObjectId, ref: 'Servicios', required: true },
    equipoId: { type: Schema.Types.ObjectId, ref: 'EquipoItem', required: true },

    // Snapshot of the equipment at ticket creation; survives equipo soft-delete.
    equipoSnapshot: { type: EquipoSnapshotSchema, default: () => ({}) },

    // Lifecycle
    status: {
      type: String,
      enum: TICKET_STATUS_VALUES,
      default: TICKET_STATUS.PENDIENTE,
      required: true,
    },
    urgency: {
      type: String,
      enum: TICKET_URGENCY_VALUES,
      required: true,
    },

    // Batch + source tracking (D4, D17). batchId is a nanoid string.
    batchId: { type: String, required: true, trim: true },
    source: { type: String, enum: TICKET_SOURCE_VALUES, required: true },
    qrId: { type: Schema.Types.ObjectId, ref: 'ServiceQr', default: null },

    // Requestor data and per-ticket observations
    requestedBy: { type: RequestedBySchema, required: true },
    observation: { type: String, trim: true, default: '', maxlength: TICKET_OBSERVATION_MAX_LENGTH },
    generalObservation: { type: String, trim: true, default: '', maxlength: TICKET_OBSERVATION_MAX_LENGTH },

    // Assignment / response metrics
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date, default: null },
    firstResponseAt: { type: Date, default: null },
    responseTimeMinutes: { type: Number, default: null },

    // OT and Report associations.
    // NOTE (design D12): workOrderId is intentionally NOT unique — many
    // tickets can share the same OT.
    workOrderId: { type: Schema.Types.ObjectId, ref: 'OT', default: null },
    workOrderCreatedAt: { type: Date, default: null },
    reportId: { type: Schema.Types.ObjectId, ref: 'Report', default: null },

    // Closure
    closedAt: { type: Date, default: null },
    resolutionTimeMinutes: { type: Number, default: null },
    closingReason: {
      type: String,
      enum: TICKET_CLOSING_REASON_VALUES,
      default: null,
    },
    closingObservation: { type: String, trim: true, default: '' },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Internal notes timeline (panel-only — stripped in public responses per D15)
    internalNotes: { type: [InternalNoteSchema], default: [] },

    // Audit: who created the ticket from the panel (null for source='qr')
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'tickets',
  }
);

// ---------- Indexes ----------
// Tenant + consecutivo MUST be unique (spec: per tenant + year unique).
TicketSchema.index({ tenantId: 1, consecutivo: 1 }, { unique: true });

// Common access patterns from the panel listing endpoint.
TicketSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
TicketSchema.index({ tenantId: 1, ClienteId: 1, status: 1 });
TicketSchema.index({ tenantId: 1, servicioId: 1, status: 1 });
TicketSchema.index({ tenantId: 1, sedeId: 1, status: 1 });
TicketSchema.index({ tenantId: 1, batchId: 1 });
TicketSchema.index({ tenantId: 1, assignedTo: 1, status: 1 });

// equipoId cascade (D20) and report cascade lookups (D14).
TicketSchema.index({ tenantId: 1, equipoId: 1, status: 1 });
TicketSchema.index({ tenantId: 1, reportId: 1 });

// IMPORTANT (D12): workOrderId index is REGULAR (not unique).
TicketSchema.index({ tenantId: 1, workOrderId: 1 });

// qrId reverse-lookup (public list scope by sessionToken).
TicketSchema.index({ tenantId: 1, qrId: 1, createdAt: -1 });

// Soft-delete filter
TicketSchema.index({ tenantId: 1, isDeleted: 1 });

// ---------- Hooks ----------
// Default query excludes soft-deleted.
TicketSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

// Default toJSON for panel responses. Public sanitization happens in the
// publicTicket.controller per design D15 — NOT here, to avoid over-stripping
// panel responses.
TicketSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

export const Ticket = model('Ticket', TicketSchema);
