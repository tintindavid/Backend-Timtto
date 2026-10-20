import { ApiError } from './apiError.util.js';
import {
  MAX_MAGNITUD_LENGTH,
  MAX_UNIDAD_LENGTH,
  MAX_PATRON_LENGTH,
} from '../constants/verificationParam.constants.js';

export const MAX_VERIFICATION_ROWS = 50;

const text = (value, max, field) => {
  const t = typeof value === 'string' ? value.trim() : '';
  if (t.length > max) {
    throw new ApiError(400, `${field} no puede superar ${max} caracteres`, 'VALIDATION_ERROR', { field });
  }
  return t;
};

const numberOrNull = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) {
    throw new ApiError(400, `${field} debe ser un número`, 'VALIDATION_ERROR', { field });
  }
  return n;
};

/**
 * Normalizes the verification-parameter rows of a report created from outside the work-order flow
 * (reportes-externos-mp-mc). Same shape and meaning as `reportService.updateVerificationParams`: trimmed
 * text, numbers or null, rows with nothing in them dropped. Differences, on purpose: an empty string is
 * "no value" (it is not turned into 0) and a non-numeric value or an over-long text is rejected with 400
 * instead of being stored.
 *
 * @param {unknown} rows
 * @returns {{ magnitud: string, unidad: string, valorReferencia: number|null, valorMedido: number|null, patron: string }[]}
 */
export function sanitizeVerificationParams(rows) {
  const incoming = Array.isArray(rows) ? rows : [];
  if (incoming.length > MAX_VERIFICATION_ROWS) {
    throw new ApiError(400, `Máximo ${MAX_VERIFICATION_ROWS} filas de parámetros`, 'VALIDATION_ERROR', { field: 'verificationParam' });
  }

  return incoming
    .map((row) => ({
      magnitud: text(row?.magnitud, MAX_MAGNITUD_LENGTH, 'magnitud'),
      unidad: text(row?.unidad, MAX_UNIDAD_LENGTH, 'unidad'),
      valorReferencia: numberOrNull(row?.valorReferencia, 'valorReferencia'),
      valorMedido: numberOrNull(row?.valorMedido, 'valorMedido'),
      patron: text(row?.patron, MAX_PATRON_LENGTH, 'patron'),
    }))
    .filter((row) => row.magnitud !== '' || row.patron !== '' || row.valorReferencia !== null || row.valorMedido !== null);
}
