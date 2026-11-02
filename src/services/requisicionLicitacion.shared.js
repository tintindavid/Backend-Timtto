import mongoose from 'mongoose';
import { Requisicion } from '../models/requisicion.model.js';
import { Customer } from '../models/customer.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { assertCapabilityOn } from '../utils/tenantModules.util.js';
import { PROVEEDOR_ESTADOS_ACTIVOS } from '../constants/requisicion.constants.js';

/** Helpers shared by the tendering services (E3). */

export const sid = (v) => (v === null || v === undefined ? '' : String(v?._id ?? v));
export const oidOf = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));
export const trimStr = (v) => (typeof v === 'string' ? v.trim() : '');
export const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
export const isValidEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim());

export const isActivo = (p) => PROVEEDOR_ESTADOS_ACTIVOS.includes(p?.estadoEnvio);
export const proveedoresOf = (doc) => (doc?.licitacion?.proveedores || []);

/** RAW capability (warn/off modes do not relax it): tendering writes never run without the module. */
export function assertModule(tenantId, capabilities) {
  return assertCapabilityOn(tenantId, 'usesRequisiciones', capabilities, 'Tu organización no tiene habilitado el módulo de Requisiciones.');
}

/** Tenant-scoped, soft-delete aware read (plain object). 404 when it does not exist or belongs to another tenant. */
export async function loadRequisicion(tenantId, id) {
  const doc = await Requisicion.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
  if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
  return doc;
}

export function assertEstado(doc, allowed) {
  if (!allowed.includes(doc.estado)) {
    throw new ApiError(409, `La requisición está en estado ${doc.estado} y no admite esta operación`, 'TRANSICION_INVALIDA', { estadoActual: doc.estado });
  }
}

export function findProveedor(doc, paId) {
  const key = sid(paId);
  const p = proveedoresOf(doc).find((x) => sid(x._id) === key);
  if (!p) throw new ApiError(404, 'Proveedor no encontrado en la requisición', 'PROVEEDOR_NO_ENCONTRADO', { paId: key });
  return p;
}

/** The supplier from the tenant's third-party catalogue (`kind = provider`); 400 PROVEEDOR_INVALIDO otherwise. */
export async function loadProveedorCatalogo(tenantId, proveedorId) {
  const c = await Customer.findOne(applyTenantFilter({ _id: proveedorId, kind: 'provider' }, tenantId)).select('Razonsocial Email').lean();
  if (!c) throw new ApiError(400, 'El proveedor no existe en el catálogo de terceros o no es un proveedor', 'PROVEEDOR_INVALIDO');
  return c;
}

/** Plain object of a Mongoose result (lean or document). */
export const plain = (d) => (d && typeof d.toObject === 'function' ? d.toObject() : d);
