import { InventarioRepuesto } from '../models/inventarioRepuesto.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';
import { getEnforcementMode, normalizeCapabilities } from '../config/tenantCapabilities.config.js';
import { INVENTARIO_ADVANCED_FIELDS } from '../dtos/inventarioRepuestoDto.js';

// Fields only the advanced level may read.
const ADVANCED_READ_FIELDS = [...INVENTARIO_ADVANCED_FIELDS, 'stockActual'];
const ADVANCED_SORT = new Set(['referencia', 'stockActual', 'precio']);
const ADVANCED_MESSAGE = 'Tu organización no tiene habilitada la gestión avanzada de stock.';

/** True when the advanced level applies (capability on, or the rollout switch is not enforcing). */
export function hasInventoryAdvanced(capabilities) {
  return normalizeCapabilities(capabilities).usesInventoryAdvanced || getEnforcementMode() !== 'on';
}

/** Basic level: hides the advanced fields of a (lean or mongoose) document. */
function shapeItem(item, capabilities) {
  if (!item || hasInventoryAdvanced(capabilities)) return item;
  const plain = typeof item.toJSON === 'function' ? item.toJSON() : { ...item };
  for (const f of ADVANCED_READ_FIELDS) delete plain[f];
  return plain;
}

function assertNoAdvancedFields(data, capabilities) {
  if (hasInventoryAdvanced(capabilities)) return;
  const sent = INVENTARIO_ADVANCED_FIELDS.filter((f) => data[f] !== undefined);
  if (sent.length > 0) {
    throw new ApiError(403, ADVANCED_MESSAGE, 'CAPABILITY_DISABLED', { capability: 'usesInventoryAdvanced', fields: sent });
  }
}

export class InventarioRepuestoService {
  async assertNameAvailable(tenantId, nombre, excludeId = null) {
    const query = applyTenantFilter({
      isDeleted: false,
      nombre: { $regex: `^${escapeRegex(String(nombre).trim())}$`, $options: 'i' },
    }, tenantId);
    if (excludeId) query._id = { $ne: excludeId };
    const dup = await InventarioRepuesto.findOne(query).select('_id').lean();
    if (dup) {
      throw new ApiError(409, 'Ya existe un ítem con ese nombre', 'DUPLICATE_ITEM', { nombre });
    }
  }

  async create(data, tenantId, capabilities) {
    requireTenant(tenantId);
    assertNoAdvancedFields(data, capabilities);
    await this.assertNameAvailable(tenantId, data.nombre);
    // Never trust tenantId nor stockActual from the body.
    const { tenantId: _t, stockActual: _s, ...clean } = data;
    const entity = await InventarioRepuesto.create({ ...clean, tenantId, stockActual: 0 });
    logger.info('InventarioRepuesto creado: ' + entity._id);
    return shapeItem(entity, capabilities);
  }

  async list(filters = {}, pagination = {}, tenantId, capabilities) {
    requireTenant(tenantId);
    const advanced = hasInventoryAdvanced(capabilities);

    const { page = 1, limit = 10, order = 'asc', search } = pagination;
    let { sortBy = 'nombre' } = pagination;
    if (!advanced && ADVANCED_SORT.has(sortBy)) sortBy = 'nombre';
    const skip = (page - 1) * limit;
    const query = applyTenantFilter({ isDeleted: false }, tenantId);

    if (filters.tipo) query.tipo = filters.tipo;
    if (filters.activo !== undefined) query.activo = filters.activo;
    if (advanced && filters.stockBajo) {
      query.$expr = { $lte: ['$stockActual', '$stockMinimo'] };
    }
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      query.$or = advanced
        ? [{ nombre: rx }, { referencia: rx }, { descripcion: rx }]
        : [{ nombre: rx }];
    }

    const sort = { [sortBy]: order === 'desc' ? -1 : 1 };
    if (sortBy !== 'nombre') sort.nombre = 1;
    const [rows, total] = await Promise.all([
      InventarioRepuesto.find(query).sort(sort).skip(skip).limit(limit).lean(),
      InventarioRepuesto.countDocuments(query),
    ]);
    const data = advanced ? rows : rows.map((r) => shapeItem(r, capabilities));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  async getById(id, tenantId, capabilities) {
    requireTenant(tenantId);
    const entity = await InventarioRepuesto.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!entity) {
      throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id });
    }
    return shapeItem(entity, capabilities);
  }

  async update(id, data, tenantId, capabilities) {
    requireTenant(tenantId);
    assertNoAdvancedFields(data, capabilities);
    const { tenantId: _t, stockActual: _s, ...clean } = data;
    if (clean.nombre) await this.assertNameAvailable(tenantId, clean.nombre, id);
    const entity = await InventarioRepuesto.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: clean },
      { new: true, runValidators: true }
    );
    if (!entity) {
      throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id });
    }
    logger.info('InventarioRepuesto actualizado: ' + id);
    return shapeItem(entity, capabilities);
  }

  async delete(id, tenantId) {
    requireTenant(tenantId);
    const entity = await InventarioRepuesto.findOneAndUpdate(
      applyTenantFilter({ _id: id }, tenantId),
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true }
    );
    if (!entity) {
      throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND', { id });
    }
    logger.info('InventarioRepuesto eliminado (soft): ' + id);
  }
}

export const inventarioRepuestoService = new InventarioRepuestoService();
