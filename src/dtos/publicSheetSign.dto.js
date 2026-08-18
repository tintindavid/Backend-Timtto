'use strict';
import Joi from 'joi';
import {
  MAX_SIGNATURE_PNG_BYTES,
  PNG_MAGIC_BYTES,
  SIGNER_NAME_MIN_LENGTH,
  SIGNER_NAME_MAX_LENGTH,
  SIGNER_CARGO_MAX_LENGTH,
} from '../constants/clientPortal.constants.js';
import { validateSignaturePng } from '../utils/validateSignaturePng.util.js';

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_PNG_BASE64_LENGTH = Math.ceil((MAX_SIGNATURE_PNG_BYTES * 4) / 3) + 4;

function sanitizeSignerString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[<>]/g, '');
}

function validateImagePng(value, helpers) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    return helpers.error('imagePng.invalidBase64');
  }
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    return helpers.error('imagePng.invalidBase64');
  }
  if (decoded.length === 0 || decoded.length > MAX_SIGNATURE_PNG_BYTES) {
    return helpers.error('imagePng.tooLarge');
  }
  if (decoded.length < PNG_MAGIC_BYTES.length || !decoded.subarray(0, PNG_MAGIC_BYTES.length).equals(PNG_MAGIC_BYTES)) {
    return helpers.error('imagePng.notPng');
  }
  return value;
}

async function validateNotBlank(value, helpers) {
  const result = await validateSignaturePng(value);
  if (!result.ok) return helpers.error(result.errorType);
  return value;
}

const signatureDto = Joi.object({
  imagePng: Joi.string()
    .required()
    .max(MAX_IMAGE_PNG_BASE64_LENGTH)
    .custom(validateImagePng)
    .external(validateNotBlank)
    .messages({
      'imagePng.invalidBase64': 'La imagen de firma no es un base64 válido',
      'imagePng.tooLarge': `La imagen de firma supera el tamaño máximo permitido (${MAX_SIGNATURE_PNG_BYTES} bytes)`,
      'imagePng.notPng': 'La imagen de firma debe ser un PNG válido',
      'imagePng.blank': 'La firma parece estar en blanco. Vuelve a firmar o carga una imagen válida.',
    }),
  signerName: Joi.string()
    .trim()
    .min(SIGNER_NAME_MIN_LENGTH)
    .max(SIGNER_NAME_MAX_LENGTH)
    .required()
    .custom((v) => sanitizeSignerString(v)),
  cargo: Joi.string()
    .trim()
    .max(SIGNER_CARGO_MAX_LENGTH)
    .allow('')
    .optional()
    .custom((v) => sanitizeSignerString(v)),
  observaciones: Joi.string()
    .trim()
    .max(2000)
    .allow('')
    .optional()
    .custom((v) => sanitizeSignerString(v)),
}).unknown(false);

export const publicSheetSignDto = Joi.object({
  signature: signatureDto.required(),
}).unknown(false);

/**
 * Reused by the admin `POST /:sheetId/sign-inplace` route so the DTO stays
 * consistent with the public flow. `personaRecibe` / `cargoRecibe` can come
 * either at the top level (admin form fields) or nested in `signature`.
 */
export const signInPlaceDto = Joi.object({
  signature: signatureDto.required(),
  personaRecibe: Joi.string().trim().max(SIGNER_NAME_MAX_LENGTH).allow('').optional(),
  cargoRecibe: Joi.string().trim().max(SIGNER_CARGO_MAX_LENGTH).allow('').optional(),
  observaciones: Joi.string().trim().max(2000).allow('').optional(),
  // Firmante técnico (opcional). Si viene, se usa su nombre + fileFirma
  // en el PDF en vez de los del user en sesión.
  firmanteUserId: Joi.string().hex().length(24).optional(),
}).unknown(false);

export default publicSheetSignDto;
