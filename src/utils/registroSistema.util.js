import { ApiError } from './apiError.util.js';

export const REGISTRO_SISTEMA = 'REGISTRO_SISTEMA';

const block = (message, details) => new ApiError(409, message, REGISTRO_SISTEMA, details);

/** Strips `esSistema` (never writable through the API) from an incoming payload. */
export function stripEsSistema(data) {
  const { esSistema: _e, ...rest } = data || {};
  return rest;
}

/** 409 REGISTRO_SISTEMA when the record is a protected default (used by delete). */
export function assertNotSistema(record, accion = 'eliminar') {
  if (record && record.esSistema === true) {
    throw block(`Es un registro por defecto del sistema: no se puede ${accion}`, { accion });
  }
}

/** true for false / 'false' / 0 / '0' (a value that would deactivate the record once coerced). */
export function isFalsy(value) {
  return value === false || value === 0 || value === 'false' || value === '0';
}

/** Name comparison for the rename guard: Unicode NFC + trim, case-SENSITIVE (a case change is a rename). */
const normalizeName = (v) => String(v).normalize('NFC').trim();

/**
 * Guards an update of a protected record: it cannot be deactivated or renamed (re-sending the same value is fine,
 * forms send the whole object). `activeField` is `activo` / `activa`; pass `null` when the model has none.
 */
export function assertSistemaUpdate(record, changes, { activeField = 'activo', nameField = 'nombre' } = {}) {
  if (!record || record.esSistema !== true) return;
  if (activeField && changes[activeField] !== undefined && isFalsy(changes[activeField])) {
    throw block('Es un registro por defecto del sistema: no se puede desactivar', { accion: 'desactivar' });
  }
  if (nameField && changes[nameField] !== undefined && normalizeName(changes[nameField]) !== normalizeName(record[nameField])) {
    throw block('Es un registro por defecto del sistema: no se puede cambiar el nombre', { accion: 'renombrar' });
  }
}

/** A protected record cannot change the listed identifying fields (same value re-sent is fine). */
export function assertSistemaLocked(record, changes, fields) {
  if (!record || record.esSistema !== true) return;
  const changed = fields.filter((k) => changes[k] !== undefined && String(changes[k]) !== String(record[k]));
  if (changed.length > 0) {
    throw block(`Es un registro por defecto del sistema: no se puede cambiar ${changed.join(' ni ')}`, { accion: 'modificar', campos: changed });
  }
}
