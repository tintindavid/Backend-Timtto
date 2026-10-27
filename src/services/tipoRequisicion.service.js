import { TipoRequisicion } from '../models/tipoRequisicion.model.js';
import { Requisicion } from '../models/requisicion.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';
import { buildPagination } from '../utils/pagination.util.js';

const normalizeCodigo = (codigo) => String(codigo).trim().toUpperCase();

function mapDuplicateKey(err) {
  if (err && err.code === 11000) {
    const key = JSON.stringify(err.keyPattern || err.keyValue || {});
    return key.includes('codigo')
      ? new ApiError(409, 'Ya existe un tipo con ese código', 'DUPLICATE_TIPO_CODE')
      : new ApiError(409, 'Ya existe un tipo con ese nombre', 'DUPLICATE_TIPO');
  }
  return err;
}

export class TipoRequisicionService {
  async assertUnique(tenantId, { codigo, nombre }, excludeId = null) {
    const exclude = excludeId ? { _id: { $ne: excludeId } } : {};
    if (codigo !== undefined) {
      const dup = await TipoRequisicion.findOne(applyTenantFilter({ codigo: normalizeCodigo(codigo), ...exclude }, tenantId)).select('_id').lean();
      if (dup) throw new ApiError(409, 'Ya existe un tipo con ese código', 'DUPLICATE_TIPO_CODE', { codigo });
    }
    if (nombre !== undefined) {
      const dup = await TipoRequisicion.findOne(applyTenantFilter({
        nombre: { $regex: `^${escapeRegex(String(nombre).trim())}$`, $options: 'i' },
        ...exclude,
      }, tenantId)).select('_id').lean();
      if (dup) throw new ApiError(409, 'Ya existe un tipo con ese nombre', 'DUPLICATE_TIPO', { nombre });
    }
  }

  async create(tenantId, data) {
    requireTenant(tenantId);
    const { tenantId: _t, ...clean } = data;
    await this.assertUnique(tenantId, { codigo: clean.codigo, nombre: clean.nombre });
    try {
      const tipo = await TipoRequisicion.create({ ...clean, codigo: normalizeCodigo(clean.codigo), tenantId });
      logger.info('TipoRequisicion creado: ' + tipo._id);
      return tipo;
    } catch (err) {
      throw mapDuplicateKey(err);
    }
  }

  async list(tenantId, filters = {}, pagination = {}) {
    requireTenant(tenantId);
    const { page = 1, limit = 10, sortBy = 'nombre', order = 'asc' } = pagination;
    const query = applyTenantFilter({}, tenantId);
    if (filters.activo !== undefined) query.activo = filters.activo;
    if (filters.search) {
      const rx = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [{ nombre: rx }, { codigo: rx }];
    }
    const sort = { [sortBy]: order === 'desc' ? -1 : 1 };
    if (sortBy !== 'nombre') sort.nombre = 1;
    const [data, total] = await Promise.all([
      TipoRequisicion.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      TipoRequisicion.countDocuments({ ...query, isDeleted: { $ne: true } }),
    ]);
    return { data, pagination: buildPagination(page, limit, total) };
  }

  async getById(tenantId, id) {
    requireTenant(tenantId);
    const tipo = await TipoRequisicion.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!tipo) throw new ApiError(404, 'Tipo de requisición no encontrado', 'TIPO_NOT_FOUND', { id });
    return tipo;
  }

  /** Type that a new requisition may use: it must exist in the tenant and be active (400 TIPO_INVALIDO). */
  async assertTipoActivo(tenantId, tipoId) {
    requireTenant(tenantId);
    const tipo = await TipoRequisicion.findOne(applyTenantFilter({ _id: tipoId, activo: true }, tenantId)).lean();
    if (!tipo) throw new ApiError(400, 'El tipo de requisición no existe o está inactivo', 'TIPO_INVALIDO', { tipoId });
    return tipo;
  }

  async update(tenantId, id, data) {
    requireTenant(tenantId);
    const { tenantId: _t, codigo: _c, ...clean } = data;
    if (clean.nombre !== undefined) await this.assertUnique(tenantId, { nombre: clean.nombre }, id);
    let tipo;
    try {
      tipo = await TipoRequisicion.findOneAndUpdate(
        applyTenantFilter({ _id: id }, tenantId),
        { $set: clean },
        { new: true, runValidators: true },
      );
    } catch (err) {
      throw mapDuplicateKey(err);
    }
    if (!tipo) throw new ApiError(404, 'Tipo de requisición no encontrado', 'TIPO_NOT_FOUND', { id });
    logger.info('TipoRequisicion actualizado: ' + id);
    return tipo;
  }

  /** Soft delete. A type referenced by a requisition cannot be deleted (409 TIPO_EN_USO): deactivate it. */
  async delete(tenantId, id) {
    requireTenant(tenantId);
    const exists = await TipoRequisicion.exists(applyTenantFilter({ _id: id }, tenantId));
    if (!exists) throw new ApiError(404, 'Tipo de requisición no encontrado', 'TIPO_NOT_FOUND', { id });
    const requisiciones = await Requisicion.countDocuments({ tenantId, tipoRequisicionId: id }).setOptions({ includeDeleted: true });
    if (requisiciones > 0) {
      throw new ApiError(409, 'El tipo está en uso por requisiciones; solo puede desactivarse', 'TIPO_EN_USO', { requisiciones });
    }
    const tipo = await TipoRequisicion.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
    if (!tipo) throw new ApiError(404, 'Tipo de requisición no encontrado', 'TIPO_NOT_FOUND', { id });
    logger.info('TipoRequisicion eliminado (soft): ' + id);
  }
}

export const tipoRequisicionService = new TipoRequisicionService();
