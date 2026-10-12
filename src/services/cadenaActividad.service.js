import { CadenaActividad } from '../models/cadenaActividad.model.js';
import { ApiError } from '../utils/apiError.util.js';

const assertString = (name, v) => {
  if (v !== undefined && typeof v !== 'string') {
    throw new ApiError(400, `${name} must be string`, 'INVALID_INPUT');
  }
};

const normalize = (s) => (s ?? '').trim().toLowerCase();

export const cadenaActividadService = {
  async listPorEquipo(tenantId, equipoId, { tipo, estado, page = 1, limit = 50 } = {}) {
    assertString('tipo', tipo);
    assertString('estado', estado);
    const filter = { tenantId, equipoId, isDeleted: false };
    if (tipo) filter.tipo = tipo;
    if (estado) filter.estado = estado;
    const [data, total] = await Promise.all([
      CadenaActividad.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CadenaActividad.countDocuments(filter),
    ]);
    return { data, meta: { total, page, limit } };
  },

  async listVigentesPorTipo(tenantId, equipoId, { tipo, tipoCustom } = {}) {
    assertString('tipo', tipo);
    assertString('tipoCustom', tipoCustom);
    if (tipo === 'otro' && !tipoCustom) return [];
    const filter = { tenantId, equipoId, tipo, estado: 'vigente' };
    if (tipo === 'otro' && tipoCustom) {
      const needle = normalize(tipoCustom);
      filter.$expr = { $eq: [{ $toLower: { $trim: { input: '$tipoCustom' } } }, needle] };
    }
    return CadenaActividad.find(filter).sort({ createdAt: -1 }).lean();
  },

  async getById(tenantId, equipoId, cadenaId) {
    const doc = await CadenaActividad.findOne({ _id: cadenaId, tenantId, equipoId }).lean();
    if (!doc) throw new ApiError(404, 'Cadena no encontrada', 'NOT_FOUND');
    return doc;
  },

  async cerrarManual(tenantId, equipoId, cadenaId, { motivoCierre, cerradaPorUserId }) {
    const result = await CadenaActividad.findOneAndUpdate(
      { _id: cadenaId, tenantId, equipoId, estado: 'vigente' },
      { $set: { estado: 'cerrada_manualmente', motivoCierre, cerradaPorUserId, cerradaAt: new Date() } },
      { new: true, runValidators: true, context: 'query' },
    ).lean();
    if (!result) throw new ApiError(404, 'Cadena no encontrada o no vigente', 'NOT_FOUND');
    return result;
  },
};
