import mongoose from 'mongoose';
import { CadenaActividad } from '../models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../models/equipoActividadExterna.model.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Executes fn with a Mongoose transaction when the server supports it
 * (replica set / sharded), otherwise falls back to running without a session.
 * In fallback mode, operations are NOT atomic — the caller's catch is
 * responsible for compensation (e.g. firebase blob cleanup).
 */
async function withOptionalTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    try {
      await session.withTransaction(async () => { await fn(session); });
      return;
    } catch (err) {
      const isStandalone = /Transaction numbers are only allowed on a replica set/i.test(err?.message ?? '')
        || err?.code === 20
        || err?.codeName === 'IllegalOperation';
      if (!isStandalone) throw err;
      logger.warn('Mongo standalone detected — running without transaction (non-atomic fallback).');
    }
  } finally {
    session.endSession();
  }
  // Fallback: no session, no atomicity.
  await fn(null);
}

const addMonths = (date, months) => { const d = new Date(date); d.setMonth(d.getMonth() + months); return d; };
const normalize = (s) => (typeof s === 'string' ? s : '').trim().toLowerCase();

// R-T2-1: nunca exponer evidencia.storagePath
const sanitizeActividad = (doc) => {
  if (!doc) return doc;
  const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  if (obj.evidencia) {
    const { storagePath: _omit, ...rest } = obj.evidencia;
    obj.evidencia = rest;
  }
  return obj;
};
const toPlain = (doc) => (doc && typeof doc.toJSON === 'function' ? doc.toJSON() : doc);

async function validateCadenaSucesion(tenantId, equipoId, cadenaId, dto) {
  const cadena = await CadenaActividad.findOne({ _id: cadenaId, tenantId, equipoId });
  if (!cadena) throw new ApiError(404, 'Cadena no encontrada', 'NOT_FOUND');
  if (cadena.estado !== 'vigente') throw new ApiError(409, 'La cadena no está vigente', 'CHAIN_NOT_VIGENTE');
  if (cadena.esUnica) throw new ApiError(400, 'Cadena única no admite sucesión', 'CHAIN_UNIQUE_NO_SUCCESSION');
  if (cadena.tipo !== dto.tipo) throw new ApiError(400, 'Tipo de actividad no coincide con la cadena', 'TYPE_MISMATCH');
  if (cadena.tipo === 'otro' && normalize(cadena.tipoCustom) !== normalize(dto.tipoCustom)) {
    throw new ApiError(400, 'tipoCustom no coincide con la cadena', 'TYPE_MISMATCH');
  }
  if (dto.frecuencia?.esUnica) throw new ApiError(400, 'Una sucesora no puede ser única', 'SUCCESSOR_CANNOT_BE_UNIQUE');
  return cadena;
}

export const actividadExternaService = {
  async create(tenantId, equipoId, clienteId, dto, file, userId) {
    if (!dto.frecuencia || typeof dto.frecuencia.esUnica !== 'boolean') {
      throw new ApiError(400, 'frecuencia requerida con esUnica boolean', 'FRECUENCIA_REQUIRED');
    }
    if (!dto.frecuencia.esUnica && (typeof dto.frecuencia.meses !== 'number' || dto.frecuencia.meses < 1)) {
      throw new ApiError(400, 'frecuenciaMeses requerido con valor >= 1 cuando !esUnica', 'FRECUENCIA_REQUIRED');
    }

    // 1. Validar sucesión antes de subir nada (evita huérfanos por validación)
    let cadenaSucesion = null;
    if (dto.cadenaIdSucesion) {
      cadenaSucesion = await validateCadenaSucesion(tenantId, equipoId, dto.cadenaIdSucesion, dto);
    }

    // 2. Upload fuera de transacción (compensamos en catch si algo falla)
    let evidencia = null;
    if (file) {
      evidencia = await firebaseStorageService.uploadActividadExternaEvidencia(
        file.buffer, file.originalname, file.mimetype, { clienteId, equipoId },
      );
    }

    try {
      let cadenaDoc;
      let actividadDoc;
      await withOptionalTransaction(async (session) => {
        const fecha = new Date(dto.fecha);
        const esUnica = !!dto.frecuencia.esUnica;
        const fechaProxima = esUnica ? null : addMonths(fecha, dto.frecuencia.meses);
        const base = {
          tenantId, clienteId, equipoId,
          tipo: dto.tipo, tipoCustom: dto.tipoCustom,
          consecutivoExterno: dto.consecutivoExterno, fecha, proveedor: dto.proveedor,
          observacion: dto.observacion, estadoFinal: dto.estadoFinal, estadoFinalCustom: dto.estadoFinalCustom,
          evidencia, enlace: dto.enlace,
          cerradaAt: null,
          createdByUserId: userId,
        };

        if (cadenaSucesion) {
          const closedPrev = await EquipoActividadExterna.findOneAndUpdate(
            { _id: cadenaSucesion.actividadVigenteId, tenantId },
            { $set: { cerradaAt: new Date() } },
            { session, new: true },
          );
          if (!closedPrev) throw new ApiError(500, 'Actividad vigente de la cadena no encontrada', 'INCONSISTENT_STATE');
          const [created] = await EquipoActividadExterna.create([{
            ...base, cadenaId: cadenaSucesion._id, esInicioCadena: false,
          }], { session });
          actividadDoc = created;
          const linkedPrev = await EquipoActividadExterna.findOneAndUpdate(
            { _id: cadenaSucesion.actividadVigenteId, tenantId },
            { $set: { cerradaPorActividadId: created._id } },
            { session, new: true },
          );
          if (!linkedPrev) throw new ApiError(500, 'Actividad vigente de la cadena no encontrada', 'INCONSISTENT_STATE');
          // Guard TOCTOU: solo avanza si la cadena sigue igual que al validar
          cadenaDoc = await CadenaActividad.findOneAndUpdate(
            { _id: cadenaSucesion._id, tenantId, estado: 'vigente', actividadVigenteId: cadenaSucesion.actividadVigenteId },
            { $set: { actividadVigenteId: created._id, frecuenciaMeses: dto.frecuencia.meses, fechaProxima } },
            { session, new: true },
          );
          if (!cadenaDoc) throw new ApiError(409, 'La cadena cambió durante la operación', 'CHAIN_NOT_VIGENTE');
        } else {
          const [nuevaCadena] = await CadenaActividad.create([{
            tenantId, clienteId, equipoId,
            tipo: dto.tipo, tipoCustom: dto.tipoCustom,
            frecuenciaMeses: esUnica ? undefined : dto.frecuencia.meses,
            esUnica,
            fechaProxima,
            estado: 'vigente',
          }], { session });
          const [created] = await EquipoActividadExterna.create([{
            ...base, cadenaId: nuevaCadena._id, esInicioCadena: true,
          }], { session });
          actividadDoc = created;
          cadenaDoc = await CadenaActividad.findOneAndUpdate(
            { _id: nuevaCadena._id, tenantId },
            { $set: { actividadVigenteId: created._id } },
            { session, new: true },
          );
          if (!cadenaDoc) throw new ApiError(500, 'Cadena no encontrada al enlazar actividad', 'INCONSISTENT_STATE');
        }
      });
      return { cadena: toPlain(cadenaDoc), actividad: sanitizeActividad(actividadDoc) };
    } catch (err) {
      if (evidencia) {
        try {
          await firebaseStorageService.deleteActividadExternaEvidencia(evidencia.storagePath);
        } catch { /* cleanup best-effort */ }
      }
      throw err;
    }
  },

  async listPorEquipo(tenantId, equipoId, { tipo, estadoCadena, page = 1, limit = 50 } = {}) {
    const filter = { tenantId, equipoId };
    if (tipo) filter.tipo = tipo;
    if (estadoCadena) filter.estado = estadoCadena;
    const [cadenas, total] = await Promise.all([
      CadenaActividad.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CadenaActividad.countDocuments(filter),
    ]);
    const cadenaIds = cadenas.map((c) => c._id);
    const actividades = cadenaIds.length
      ? await EquipoActividadExterna.find({ tenantId, cadenaId: { $in: cadenaIds } }).sort({ fecha: -1 }).lean()
      : [];
    const porCadena = new Map(cadenas.map((c) => [String(c._id), { cadena: c, actividades: [] }]));
    for (const a of actividades) porCadena.get(String(a.cadenaId))?.actividades.push(sanitizeActividad(a));
    return { data: [...porCadena.values()], meta: { total, page, limit } };
  },

  async getById(tenantId, equipoId, id) {
    const doc = await EquipoActividadExterna.findOne({ _id: id, tenantId, equipoId }).lean();
    if (!doc) throw new ApiError(404, 'Actividad no encontrada', 'NOT_FOUND');
    return sanitizeActividad(doc);
  },

  async update(tenantId, equipoId, id, dto = {}, file) {
    const existing = await EquipoActividadExterna.findOne({ _id: id, tenantId, equipoId });
    if (!existing) throw new ApiError(404, 'Actividad no encontrada', 'NOT_FOUND');

    const set = {};
    for (const k of ['observacion', 'estadoFinal', 'estadoFinalCustom', 'enlace']) {
      if (dto[k] !== undefined) set[k] = dto[k];
    }
    const unset = {};
    const efectivo = set.estadoFinal !== undefined ? set.estadoFinal : existing.estadoFinal;
    if (efectivo === 'otro') {
      const customEfectivo = set.estadoFinalCustom !== undefined
        ? normalize(set.estadoFinalCustom) : normalize(existing.estadoFinalCustom);
      if (!customEfectivo) {
        throw new ApiError(400, 'estadoFinalCustom requerido cuando estadoFinal es "otro"', 'ESTADO_FINAL_CUSTOM_REQUIRED');
      }
    }
    if (set.estadoFinalCustom !== undefined && efectivo !== 'otro') {
      throw new ApiError(400, 'estadoFinalCustom solo aplica cuando estadoFinal es "otro"', 'ESTADO_FINAL_CUSTOM_REQUIRED');
    }
    if (set.estadoFinal !== undefined && set.estadoFinal !== 'otro' && existing.estadoFinalCustom) {
      unset.estadoFinalCustom = 1;
    }

    let evidencia = null;
    if (file) {
      evidencia = await firebaseStorageService.uploadActividadExternaEvidencia(
        file.buffer, file.originalname, file.mimetype,
        { clienteId: String(existing.clienteId), equipoId: String(existing.equipoId) },
      );
      set.evidencia = evidencia;
    }
    const oldPath = file ? (existing.evidencia?.storagePath ?? null) : null;

    try {
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      const updated = Object.keys(update).length
        ? await EquipoActividadExterna.findOneAndUpdate(
          { _id: id, tenantId, equipoId }, update,
          { new: true, runValidators: true, context: 'query' },
        )
        : existing;
      if (!updated) throw new ApiError(404, 'Actividad no encontrada', 'NOT_FOUND');
      if (oldPath) {
        try { await firebaseStorageService.deleteActividadExternaEvidencia(oldPath); } catch { /* best-effort */ }
      }
      return sanitizeActividad(updated);
    } catch (err) {
      if (evidencia) {
        try { await firebaseStorageService.deleteActividadExternaEvidencia(evidencia.storagePath); } catch { /* best-effort */ }
      }
      throw err;
    }
  },

  async remove(tenantId, equipoId, id) {
    const actividad = await EquipoActividadExterna.findOne({ _id: id, tenantId, equipoId });
    if (!actividad) throw new ApiError(404, 'Actividad no encontrada', 'NOT_FOUND');
    if (actividad.cerradaAt) {
      throw new ApiError(400, 'No se puede borrar una actividad histórica. Solo la vigente.', 'CANNOT_DELETE_HISTORICAL');
    }

    {
      await withOptionalTransaction(async (session) => {
        // Fallback mode (standalone Mongo): no atomicity. If a later step fails after the
        // soft-delete, the actividad stays deleted but the chain is not updated (accepted tradeoff).
        const now = new Date();
        const softDelete = { $set: { isDeleted: true, deletedAt: now } };
        // Guard TOCTOU: solo borra si sigue vigente (no cerrada por una sucesion concurrente)
        const res = await EquipoActividadExterna.updateOne(
          { _id: id, tenantId, equipoId, cerradaAt: null }, softDelete, { session },
        );
        if (res?.matchedCount === 0) {
          throw new ApiError(400, 'La actividad ya no es la vigente', 'CANNOT_DELETE_HISTORICAL');
        }
        if (actividad.esInicioCadena) {
          await CadenaActividad.updateOne({ _id: actividad.cadenaId, tenantId }, softDelete, { session });
        } else {
          const pred = await EquipoActividadExterna.findOne({ cerradaPorActividadId: id, tenantId }, null, { session });
          if (!pred) throw new ApiError(500, 'Estado inconsistente: no se encontró predecesora', 'INCONSISTENT_STATE');
          await EquipoActividadExterna.updateOne(
            { _id: pred._id, tenantId },
            { $set: { cerradaAt: null, cerradaPorActividadId: null } },
            { session },
          );
          const cadena = await CadenaActividad.findOne({ _id: actividad.cadenaId, tenantId }, null, { session });
          if (!cadena) throw new ApiError(500, 'Cadena no encontrada', 'INCONSISTENT_STATE');
          const fechaProxima = cadena.esUnica ? null : addMonths(pred.fecha, cadena.frecuenciaMeses);
          await CadenaActividad.findOneAndUpdate(
            { _id: actividad.cadenaId, tenantId },
            { $set: { actividadVigenteId: pred._id, fechaProxima } },
            { session },
          );
        }
      });
    }
    if (actividad.evidencia?.storagePath) {
      try { await firebaseStorageService.deleteActividadExternaEvidencia(actividad.evidencia.storagePath); } catch { /* best-effort */ }
    }
    return { ok: true };
  },

  async removeEvidencia(tenantId, equipoId, id) {
    const actividad = await EquipoActividadExterna.findOne({ _id: id, tenantId, equipoId });
    if (!actividad) throw new ApiError(404, 'Actividad no encontrada', 'NOT_FOUND');
    const path = actividad.evidencia?.storagePath;
    if (!path) throw new ApiError(400, 'La actividad no tiene evidencia', 'NO_EVIDENCE');
    const updated = await EquipoActividadExterna.findOneAndUpdate(
      { _id: id, tenantId, equipoId }, { $unset: { evidencia: 1 } }, { new: true },
    );
    try { await firebaseStorageService.deleteActividadExternaEvidencia(path); } catch { /* best-effort */ }
    return sanitizeActividad(updated);
  },
};
