'use strict';
import Joi from 'joi';
import {
  MAX_SIGNATURE_PNG_BYTES,
  PNG_MAGIC_BYTES,
  SIGNER_NAME_MIN_LENGTH,
  SIGNER_NAME_MAX_LENGTH,
  SIGNER_ID_MIN_LENGTH,
  SIGNER_ID_MAX_LENGTH,
  SIGNER_CARGO_MAX_LENGTH,
} from '../constants/clientPortal.constants.js';

const objectId = Joi.string().hex().length(24);

// Strict base64 (RFC 4648, with padding) — rejects data-URL prefixes,
// whitespace and any non-base64 character before attempting to decode.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// base64 encodes 3 raw bytes as 4 chars → cap the raw string length to
// ceil(MAX_SIGNATURE_PNG_BYTES * 4 / 3) rounded up with padding tolerance
// so `.max()` rejects oversized payloads BEFORE allocating a Buffer
// (security auditor Low: "check value.length pre-decode"). The existing
// global express.json({limit:'10mb'}) bounds the overall body; this is
// the tighter per-field bound.
const MAX_IMAGE_PNG_BASE64_LENGTH = Math.ceil((MAX_SIGNATURE_PNG_BYTES * 4) / 3) + 4;

/**
 * Strip characters that could start an HTML tag from a signer name /
 * cédula / cargo. Defense in depth alongside the render-time HTML escape
 * in sheetworkPDF.service.js#esc — design D10 asked for BOTH layers so
 * the raw stored value already looks clean in the admin UI even if the
 * render escape is one day accidentally dropped. Keeps every other char
 * (spaces, accents, digits, punctuation).
 */
function sanitizeSignerString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[<>]/g, '');
}

/**
 * Validates `signature.imagePng`: strict base64, decoded size within
 * MAX_SIGNATURE_PNG_BYTES, and PNG magic bytes (design D10) — protects
 * against mimetype sniffing / disguised payloads (e.g. SVG, JPEG).
 */
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

const signatureDto = Joi.object({
  imagePng: Joi.string()
    .required()
    .max(MAX_IMAGE_PNG_BASE64_LENGTH)
    .custom(validateImagePng)
    .messages({
      'imagePng.invalidBase64': 'La imagen de firma no es un base64 válido',
      'imagePng.tooLarge': `La imagen de firma supera el tamaño máximo permitido (${MAX_SIGNATURE_PNG_BYTES} bytes)`,
      'imagePng.notPng': 'La imagen de firma debe ser un PNG válido',
    }),
  signerName: Joi.string()
    .trim()
    .min(SIGNER_NAME_MIN_LENGTH)
    .max(SIGNER_NAME_MAX_LENGTH)
    .required()
    .custom((v) => sanitizeSignerString(v)),
  // Kept in the schema as OPTIONAL for backwards compat with any client
  // that still sends a cédula, but the SignatureModal UI no longer asks
  // for it (2026-08-02) since the backend never persisted it anyway.
  signerId: Joi.string()
    .trim()
    .min(SIGNER_ID_MIN_LENGTH)
    .max(SIGNER_ID_MAX_LENGTH)
    .allow('')
    .optional()
    .custom((v) => sanitizeSignerString(v)),
  cargo: Joi.string()
    .trim()
    .max(SIGNER_CARGO_MAX_LENGTH)
    .allow('')
    .optional()
    .custom((v) => sanitizeSignerString(v)),
  // Free-form observations shown in the HT PDF's "Observaciones" section
  // (2026-08-02). Persists to SheetWork.observaciones on the auto-generated
  // sheet for each OT.
  observaciones: Joi.string()
    .trim()
    .max(2000)
    .allow('')
    .optional()
    .custom((v) => sanitizeSignerString(v)),
}).unknown(false);

/** POST /public/client-view/:token/sign */
export const clientPortalSignDto = Joi.object({
  reportIds: Joi.array().items(objectId.required()).min(1).required(),
  signature: signatureDto.required(),
}).unknown(false);

export default clientPortalSignDto;
