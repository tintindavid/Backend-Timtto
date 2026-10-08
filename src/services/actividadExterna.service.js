import mongoose from 'mongoose';
import { CadenaActividad } from '../models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../models/equipoActividadExterna.model.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { ApiError } from '../utils/apiError.util.js';

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

    let session;
    try {
      session = await mongoose.startSession();
      let cadenaDoc;
      let actividadDoc;
      await session.withTransaction(async () => {
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
          await EquipoActividadExterna.findOneAndUpdate(
            { _id: cadenaSucesion.actividadVigenteId, tenantId },
            { $set: { cerradaAt: new Date() } },
            { session },
          );
          const [created] = await EquipoActividadExterna.create([{
            ...base, cadenaId: cadenaSucesion._id, esInicioCadena: false,
          }], { session });
          actividadDoc = created;
          await EquipoActividadExterna.findOneAndUpdate(
            { _id: cadenaSucesion.actividadVigenteId, tenantId },
            { $set: { cerradaPorActividadId: created._id } },
            { session },
          );
          cadenaDoc = await CadenaActividad.findOneAndUpdate(
            { _id: cadenaSucesion._id, tenantId },
            { $set: { actividadVigenteId: created._id, frecuenciaMeses: dto.frecuencia.meses, fechaProxima } },
            { session, new: true },
          );
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
    } finally {
      if (session) session.endSession();
    }
  },
};
