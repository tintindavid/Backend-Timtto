import { Customer } from '../models/customer.model.js';
import { Sedes } from '../models/sedes.model.js';
import { Servicios } from '../models/servicios.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import { buildCsv } from '../utils/csvBuilder.util.js';
import { escapeRegex } from '../utils/escapeRegex.util.js';
import { assertCapability } from '../config/tenantCapabilities.config.js';

const CUSTOMER_KINDS = ['customer', 'provider'];
const CUSTOMER_LIST_KINDS = [...CUSTOMER_KINDS, 'all'];

// Fields the default branch ("Principal") needs; the Sede model requires them, so a client created
// without them used to leave an orphan customer behind (500).
const BRANCH_REQUIRED_FIELDS = ['TelContacto', 'UserContacto', 'Departamento'];
const BRANCH_FIELD_LABELS = { TelContacto: 'teléfono de contacto', UserContacto: 'persona de contacto', Departamento: 'departamento' };

const CUSTOMER_KIND_DENIED_MESSAGE =
  'Tu organización no ejecuta servicios, por lo que no puede crear ni eliminar clientes. Los proveedores sí están permitidos.';

export class CustomerService {
  /**
   * Crea un nuevo customer con logo (si se proporciona)
   * @param {object} data - Datos del customer
   * @param {string} tenantId - ID del tenant
   * @param {object} logoFile - Archivo del logo (opcional) { buffer, originalname, mimetype }
   * @param {object} [capabilities] - req.tenant.capabilities; a kind=customer needs executesServices
   *   (providers are always allowed). Omitted = defaults (provider tenant).
   * @returns {Promise<object>} Customer creado
   */
  async create(data, tenantId, logoFile = null, capabilities = undefined) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;

      // kind: the POST route has no Joi validation (multipart), so validate here.
      const kind = data.kind === undefined || data.kind === null || data.kind === '' ? 'customer' : data.kind;
      if (!CUSTOMER_KINDS.includes(kind)) {
        throw new ApiError(400, "El tipo de tercero debe ser 'customer' o 'provider'", 'INVALID_KIND', { kind });
      }
      data.kind = kind;

      if (kind === 'customer') {
        // Capability ceiling (tenant-capabilities-hybrid-mode): before any upload or insert.
        assertCapability(capabilities, 'executesServices', CUSTOMER_KIND_DENIED_MESSAGE);

        // Validate the data of the default branch BEFORE inserting so a failure never leaves an
        // orphan customer (the Sede insert would otherwise fail after the Customer was stored).
        const missing = BRANCH_REQUIRED_FIELDS.filter((f) => {
          const v = data[f];
          return v === undefined || v === null || String(v).trim() === '';
        });
        if (missing.length) {
          throw new ApiError(
            400,
            `Para crear la sede principal del cliente faltan datos: ${missing.map((f) => BRANCH_FIELD_LABELS[f]).join(', ')}`,
            'MISSING_BRANCH_DATA',
            { fields: missing },
          );
        }
      }

      // Si se proporciona un logo, subirlo a Firebase Storage
      if (logoFile && logoFile.buffer) {
        logger.info('Subiendo logo a Firebase Storage...');
        const logoUrl = await firebaseStorageService.uploadLogo(
          logoFile.buffer,
          logoFile.originalname,
          logoFile.mimetype
        );
        data.Logo = logoUrl;
      }
      const entity = await Customer.create(data);

      // Providers have no branches or services: skip the default Sede/Servicio.
      if (kind === 'provider') {
        logger.info('Customer (provider) creado: ' + entity._id);
        return entity;
      }

      const payloadSedes = {
        tenantId: t,
        Cliente: entity._id,
        nombreSede: 'Principal',
        contact: entity.UserContacto || '',
        departamento: entity.Departamento || '',
        ciudad: entity.Ciudad || '',
        direccion: entity.Direccion || '',
        telefono: entity.TelContacto || '',
        email: entity.Email || '',
      };

      const sede = await Sedes.create(payloadSedes);

      const payloadServicio = {
        tenantId: t,
        Cliente: entity._id,
        sedeId: sede._id,
        nombre: 'Principal',
        observacion: 'Servicio creado por defecto al crear el cliente',
      };

      await Servicios.create(payloadServicio);

      logger.info('Customer creado: ' + entity._id);
      return entity;
    } catch (err) {
      logger.error('Error creando customer:', err);
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Error creando Customer', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        order = 'desc',
        search,
        razonSocial,
        ciudad,
        nit,
      } = pagination;
      const skip = (page - 1) * limit;
      // `kind` is never a raw filter: customer (default) = everything but providers
      // (legacy docs without kind count as customers), provider = providers only,
      // all = no kind filter.
      const { kind = 'customer', ...restFilters } = filters;
      if (!CUSTOMER_LIST_KINDS.includes(kind)) {
        throw new ApiError(400, "El parámetro 'kind' debe ser 'customer', 'provider' o 'all'", 'INVALID_KIND', { kind });
      }
      const query = applyTenantFilter({ ...restFilters, isDeleted: false }, tenantId);
      if (kind === 'customer') query.kind = { $ne: 'provider' };
      else if (kind === 'provider') query.kind = 'provider';

      // escapeRegex extracted to src/utils/escapeRegex.util.js (2026-08-11)

      if (search) {
        const rx = new RegExp(escapeRegex(search), 'i');
        query.$or = [{ Razonsocial: rx }, { Ciudad: rx }, { Email: rx }];
      }
      if (razonSocial) {
        query.Razonsocial = new RegExp(escapeRegex(razonSocial), 'i');
      }
      if (ciudad) {
        query.Ciudad = new RegExp(escapeRegex(ciudad), 'i');
      }
      if (nit) {
        // Nit is stored as Number but users search it as a prefix / substring
        // string. Cast on the fly with $expr + $regexMatch so we don't need
        // a migration to a String column.
        const nitPattern = escapeRegex(nit);
        query.$expr = {
          $regexMatch: {
            input: { $toString: '$Nit' },
            regex: nitPattern,
            options: 'i',
          },
        };
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        Customer.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Customer.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error listando customers:', err);
      throw new ApiError(500, 'Error listando Customers', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await Customer.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo customer:', err);
      throw new ApiError(500, 'Error obteniendo Customer', 'GET_ERROR');
    }
  }

  /**
   * Actualiza un customer, incluyendo reemplazo de logo si se proporciona
   * @param {string} id - ID del customer
   * @param {object} data - Datos a actualizar
   * @param {string} tenantId - ID del tenant
   * @param {object} logoFile - Archivo del logo nuevo (opcional) { buffer, originalname, mimetype }
   * @returns {Promise<object>} Customer actualizado
   */
  async update(id, data, tenantId, logoFile = null) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);

      // kind is immutable: the PUT/PATCH routes have no Joi validation, so drop it here.
      delete data.kind;

      // Obtener customer actual para verificar si tiene logo previo
      const currentCustomer = await Customer.findOne(applyTenantFilter({ _id: id }, t));
      if (!currentCustomer) {
        throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      }

      // Si se proporciona un nuevo logo
      if (logoFile && logoFile.buffer) {
        logger.info('Reemplazando logo en Firebase Storage...');
        logger.debug('Datos del nuevo logo:', {
          originalname: logoFile.originalname,
          mimetype: logoFile.mimetype,
          size: logoFile.buffer.length,
        });
        const oldLogoUrl = currentCustomer.Logo;
        
        // Subir nuevo logo y eliminar el anterior
        const newLogoUrl = await firebaseStorageService.replaceLogo(
          oldLogoUrl,
          logoFile.buffer,
          logoFile.originalname,
          logoFile.mimetype
        );
        data.Logo = newLogoUrl;
      }

      const e = await Customer.findOneAndUpdate(
        applyTenantFilter({ _id: id }, t),
        { $set: data },
        { new: true, runValidators: true }
      );
      
      if (!e) throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      logger.info('Customer actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando customer:', err);
      throw new ApiError(500, 'Error actualizando Customer', 'UPDATE_ERROR');
    }
  }

  /**
   * Elimina un customer (soft delete) y su logo de Firebase Storage
   * @param {string} id - ID del customer
   * @param {string} tenantId - ID del tenant
   * @param {object} [capabilities] - req.tenant.capabilities; deleting a kind=customer needs
   *   executesServices (providers are always allowed). Omitted = defaults (provider tenant).
   */
  async delete(id, tenantId, capabilities = undefined) {
    try {
      requireTenant(tenantId);
      
      // Obtener customer antes de eliminarlo para limpiar el logo
      const customer = await Customer.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!customer) {
        throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });
      }

      // Capability ceiling by the STORED kind (legacy documents without kind are customers).
      if (customer.kind !== 'provider') {
        assertCapability(capabilities, 'executesServices', CUSTOMER_KIND_DENIED_MESSAGE);
      }

      // Soft delete del customer
      const e = await Customer.findOneAndUpdate(
        applyTenantFilter({ _id: id }, tenantId),
        { $set: { isDeleted: true, deletedAt: new Date() } },
        { new: true }
      );
      
      if (!e) throw new ApiError(404, 'Customer no encontrado', 'NOT_FOUND', { id });

      // Eliminar logo de Firebase Storage (en background)
      if (customer.Logo) {
        firebaseStorageService.deleteLogo(customer.Logo).catch(err => {
          logger.error('Error eliminando logo al borrar customer:', err);
        });
      }

      logger.info('Customer eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando customer:', err);
      throw new ApiError(500, 'Error eliminando Customer', 'DELETE_ERROR');
    }
  }

  /**
   * Builds a CSV export of all customers for the tenant, optionally filtered
   * by the same `search` regex as the list endpoint. No pagination — we stream
   * the entire dataset because the operator asked for it explicitly.
   *
   * Returns `{ csv, filename }` so the controller can set Content-Disposition.
   */
  async exportCsv({ search } = {}, tenantId) {
    try {
      requireTenant(tenantId);
      const query = applyTenantFilter({ isDeleted: false, kind: { $ne: 'provider' } }, tenantId);
      if (search) {
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        query.$or = [{ Razonsocial: rx }, { Ciudad: rx }, { Email: rx }];
      }
      const rows = await Customer.find(query)
        .sort({ Razonsocial: 1 })
        .select('Razonsocial Nit Ciudad Departamento Direccion Email TelContacto UserContacto createdAt')
        .lean();

      const columns = [
        { key: 'Razonsocial', label: 'Razón Social' },
        { key: 'Nit', label: 'NIT' },
        { key: 'Ciudad', label: 'Ciudad' },
        { key: 'Departamento', label: 'Departamento' },
        { key: 'Direccion', label: 'Dirección' },
        { key: 'Email', label: 'Email' },
        { key: 'TelContacto', label: 'Teléfono' },
        { key: 'UserContacto', label: 'Persona de contacto' },
        { key: 'createdAt', label: 'Creado' },
      ];
      const formattedRows = rows.map((row) => ({
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : '',
      }));

      const csv = buildCsv(formattedRows, columns);
      const filename = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
      // Prepend BOM so Excel opens UTF-8 correctly.
      return { csv: `﻿${csv}`, filename };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error exportando customers:', err);
      throw new ApiError(500, 'Error exportando clientes', 'EXPORT_ERROR');
    }
  }
}

export const customerService = new CustomerService();
