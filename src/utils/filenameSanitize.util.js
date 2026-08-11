'use strict';
import {
  PDF_FILENAME_SEPARATOR,
  PDF_FILENAME_MAX_LENGTH,
} from '../constants/pdfReports.constants.js';

// Windows-reserved chars per Microsoft's Naming Files docs. Space is NOT here
// — it becomes `_` via the collapser below. Hyphen is NOT here — consecutivos
// like `OT-2026-001` must survive.
const WINDOWS_RESERVED_CHARS_RE = /[<>:"/\\|?*]/g;
const COMBINING_DIACRITICS_RE = /[̀-ͯ]/g;
const WHITESPACE_UNDERSCORE_RUN_RE = /[\s_]+/g;
const LEADING_TRAILING_UNDERSCORE_RE = /^_+|_+$/g;

/**
 * NFD accent-fold + strip Windows-reserved chars + collapse whitespace/underscore
 * runs. Casing preserved on purpose — technicians scan by shape and uppercased
 * item text reads faster in file managers.
 */
export function sanitizeFilenameSegment(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return raw
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_RE, '')
    .replace(WINDOWS_RESERVED_CHARS_RE, '')
    .replace(WHITESPACE_UNDERSCORE_RUN_RE, '_')
    .replace(LEADING_TRAILING_UNDERSCORE_RE, '');
}

function formatDateYMD(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolves a single filename token from a populated report doc. Missing
 * values render as `SN` (Sin Número) so the separator structure stays intact;
 * missing dates render as `sin-fecha`.
 */
export function resolveTokenValue(report, token) {
  const snap = report?.equipoSnapshot || {};
  switch (token) {
    case 'consecutivo':
      return report?.consecutivo || String(report?._id || 'SN');
    case 'serial':
      return snap.Serie || 'SN';
    case 'inventario':
      return snap.Inventario || 'SN';
    case 'item':
      return snap.ItemText || 'SN';
    case 'fecha': {
      const raw =
        report?.fechaProcesado || report?.fechaFinalizdo || report?.createdAt || null;
      return formatDateYMD(raw) || 'sin-fecha';
    }
    default:
      return '';
  }
}

/**
 * Composes the per-report filename from a list of tokens in order. Sanitizes
 * each segment, joins with `_`, caps at PDF_FILENAME_MAX_LENGTH, appends `.pdf`.
 */
export function buildBulkPdfFilename(report, tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const segments = tokens
    .map((token) => sanitizeFilenameSegment(resolveTokenValue(report, token)))
    .filter((seg) => seg.length > 0);
  if (segments.length === 0) return null;
  let name = segments.join(PDF_FILENAME_SEPARATOR);
  if (name.length > PDF_FILENAME_MAX_LENGTH) {
    name = name.slice(0, PDF_FILENAME_MAX_LENGTH).replace(LEADING_TRAILING_UNDERSCORE_RE, '');
  }
  return `${name}.pdf`;
}
