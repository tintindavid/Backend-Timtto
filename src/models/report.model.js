import mongoose from 'mongoose';
import { type } from 'os';
import {
  MAX_EVIDENCES,
  ALLOWED_EVIDENCE_MIME,
  MAX_EVIDENCE_DESCRIPTION_LENGTH,
} from '../constants/evidence.constants.js';
import {
  MAX_MAGNITUD_LENGTH,
  MAX_UNIDAD_LENGTH,
  MAX_PATRON_LENGTH,
} from '../constants/verificationParam.constants.js';

const { Schema, model } = mongoose;

const VerificationParamSchema = new Schema({
  magnitud: { type: String, trim: true, maxlength: MAX_MAGNITUD_LENGTH, default: '' },
  unidad: { type: String, trim: true, maxlength: MAX_UNIDAD_LENGTH, default: '' },
  valorReferencia: { type: Number, default: null },
  valorMedido: { type: Number, default: null },
  patron: { type: String, trim: true, maxlength: MAX_PATRON_LENGTH, default: '' },
}, { _id: true });

const EvidenciaSchema = new Schema({
  url: { type: String, required: true, trim: true },
  storagePath: { type: String, required: true, trim: true },
  nombre: { type: String, required: true, trim: true },
  tipo: { type: String, enum: ['imagen'], default: 'imagen' },
  mimetype: { type: String, required: true, enum: ALLOWED_EVIDENCE_MIME },
  size: { type: Number, required: true, min: 0 },
  descripcion: { type: String, trim: true, default: '', maxlength: MAX_EVIDENCE_DESCRIPTION_LENGTH },
  fechaSubida: { type: Date, default: Date.now },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: true });

const ReportSchema = new Schema({
    tenantId: { type: String, required: true },
    AccesoriosDelEquipo: { type: String,  trim: true },
    CausaEncontrada: { type: String,  trim: true },
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer',  trim: true },
    /* Consecutivo automatico del reporte */
    consecutivo: { type: String,  trim: true },
    duracion: { type: Number,  trim: true, default: 45 }, // Duración en minutos
    Equipo: { type: Schema.Types.ObjectId, ref: 'EquipoItem',  trim: true },
    /* Estado del equipo al finalizar la revision, es un Enum */
    EstadoOperativo: { type: String, enum: ['Operativo', 'Fuera de Servicio', 'En Mantenimiento', 'Espera de Repuestos', 'En Reparacion'],  trim: true },
    /* Estado del reporte, es un Enum */
    estado: { type: String, enum: ['Pendiente','Abierto', 'En Progreso', 'Cerrado', 'Cancelado','Procesado'], trim: true },
    fechaCancelado: { type: Date,  trim: true },
    FechaCreacion: { type: Date,  trim: true },
    fechaFinalizdo: { type: Date,  trim: true },
    fechaProcesado: { type: Date,  trim: true },
    fallaReportada: { type: String,  trim: true },
    diagnostico: { type: String,  trim: true },
    accionTomada: { type: String,  trim: true },
    MotivoFueraDeServicio: { type: String,  trim: true },
    fechaCancelacion: { type: Date,  trim: true },
    motivoCancelacion: { type: String,  trim: true },
    hojaDeTrabajo: { type: Schema.Types.ObjectId, ref: 'SheetWork'  ,  trim: true },
    // Trazabilidad: quién procesó el reporte (independiente del que firma
    // la HT). snapshotName congelado en el momento del `procesar` para
    // sobrevivir a cambios de nombre / soft-delete del user, mismo patrón
    // que programaciones[i].responsables (ot-responsables-programacion-trazable).
    procesadoPor: {
      _id: false,
      userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      snapshotName: { type: String, trim: true, default: null },
      fechaProceso: { type: Date, default: null },
    },
    equipoSnapshot:
      {
        ItemText: { type: String,  trim: true },
        Marca: { type: String,  trim: true },
        Modelo: { type: String,  trim: true },
        Sede: { type: String,  trim: true },
        Serie: { type: String,  trim: true },
        Inventario: { type: String,  trim: true },
        Servicio: { type: String,  trim: true },
        Ubicacion: { type: String,  trim: true },
        MesesMtto: [{ type: String, trim: true }],
      },
    actividadesRealizadas: [
      { 
        actividadProtocoloId: { type: String,  trim: true },
        descripcion: { type: String,  trim: true },
        realizado: { type: Boolean,  trim: true },
        fecha:  { type: Date,  trim: true },
        observaciones: { type: String,  trim: true },
      }
    ],
    inHt:{type: Boolean, default: false },
    observacion: { type: String,  trim: true },
    observacionEstadoFinal: { type: String,  trim: true },
    orden: { type: Schema.Types.ObjectId, ref: 'OT',  trim: true },
    reporterecibido: { type: String,  trim: true },
    estadoOperativo: { type: String,  enum: ['Operativo', 'Fuera de Servicio', 'En Mantenimiento', 'Espera de Repuestos', 'En Reparacion'], trim: true
    },
    ReportPDF: { type: String,  trim: true },  // Path to generated PDF
    evidencias: {
      type: [EvidenciaSchema],
      default: [],
      validate: {
        validator: (arr) => !arr || arr.length <= MAX_EVIDENCES,
        message: `A report can have at most ${MAX_EVIDENCES} evidences`,
      },
    },
    verificationParam: { type: [VerificationParamSchema], default: [] },
    ResponsableMtto: { type: Schema.Types.ObjectId, ref: 'User',  trim: true },
    /* Tipo de mantenimiento — enum debe ser un superconjunto del enum de OT.TipoServicio
       porque report.service copia TipoServicio → tipoMtto tal cual. Ambas variantes de
       'Diagnóstico' (con y sin tilde) están permitidas por retrocompat: la ASCII vino
       del ticket-area flow (D10), y la con tilde es la forma canónica del <option> del
       frontend. Igual para Instalación / Proactivo — sin esto crear una OT con esos
       TipoServicio falla al construir los Reports. */
    tipoMtto: {
      type: String,
      enum: ['Preventivo', 'Correctivo', 'Predictivo', 'Instalación', 'Proactivo', 'Diagnostico', 'Diagnóstico'],
      trim: true,
      default: 'Preventivo',
    },

    /* Ticket-area integration: reports created from a ticket carry the ticket
       reference and the isFromTicket=true flag. Cascades (close/cancel) live
       in report.service.js per design D14. */
    ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },
    isFromTicket: { type: Boolean, default: false, index: true },

  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  /* Client-portal review state (change B, design D1). Optional sub-doc —
     undefined on reports never opened/reviewed from the client portal.
     `reviewedByTokenId` is intentionally never exposed via toJSON/DTOs
     outside internal audit (task 6.2 whitelist maps only `reviewedAt`). */
  clientReview: {
    reviewedAt: { type: Date, default: null },
    reviewedByTokenId: { type: Schema.Types.ObjectId, ref: 'ClientAccessToken', default: null },
  },
  /* Free-form note the CLIENT can attach to a single report from the portal
     (feature added 2026-08-02). Persists across the review/sign lifecycle so
     admins can see "el cliente aclaró X sobre este equipo" even after the
     HT is signed. `updatedByTokenId` is audit-only, whitelist mappers only
     expose `{ text, updatedAt }` to the public payload. Max text length is
     enforced in the DTO, not the schema, so backfill scripts aren't broken
     by a hard cap change. */
  clientNote: {
    text: { type: String, trim: true, default: null },
    updatedAt: { type: Date, default: null },
    updatedByTokenId: { type: Schema.Types.ObjectId, ref: 'ClientAccessToken', default: null },
  },
}, {
  timestamps: true,
  collection: 'reports'
});

// Indexes (tenant-aware)
ReportSchema.index({ tenantId: 1, isDeleted: 1 });
ReportSchema.index({ tenantId: 1, createdAt: -1 });
ReportSchema.index({ tenantId: 1, isFromTicket: 1, ticket: 1 });

// Exclude sensitive fields
ReportSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ReportSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Report = model('Report', ReportSchema);
