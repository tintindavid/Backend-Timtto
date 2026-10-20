'use strict';

const REDACTED = '[REDACTED]';

// Query parameters whose value is a credential (reset tokens, API keys, passwords...).
const SENSITIVE_PARAM = /(token|password|passwd|secret|key|authorization|signature)/i;

// Public routes whose first path segment after the prefix is an opaque bearer token.
const TOKEN_PATH_PREFIXES = [
  '/public/client-view/',
  '/public/sheet-sign/',
  '/public/sheet-download/',
  '/public/tickets/',
  '/public/ticket/',
  '/public/equipo/',
  '/api/public/equipo/',
  '/portal/',
  '/firma/',
  '/hoja-descarga/',
];

/** Percent-encodes control and line-separator characters so one log entry stays one line. */
function escapeControlChars(text) {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (ch) => encodeURIComponent(ch));
}

/** Percent-decodes for matching so `%2Fportal%2F` or encoded prefixes cannot hide a token; falls back to the raw text. */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return text;
  }
}

/**
 * Masks credentials in a URL or path before it reaches the access log (spec: token-log-hygiene).
 * Works with relative URLs (request line) and absolute URLs (referrer). Non-strings pass through.
 *
 * @param {string} url
 * @returns {string}
 */
export function redactSensitiveUrl(url) {
  if (typeof url !== 'string' || url === '') return url;

  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = noHash.indexOf('?');
  const rawPath = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  // Unchanged unless a token route is detected (so ordinary URLs are logged exactly as before).
  let pathPart = rawPath;
  const query = qIdx >= 0 ? noHash.slice(qIdx + 1) : null;

  // Detection runs on the percent-decoded, lower-cased path so encoded or upper-case prefixes cannot
  // hide a token. When one is found the decoded path is what gets masked and returned.
  const decoded = safeDecode(rawPath);
  const lowerPath = decoded.toLowerCase();
  for (const prefix of TOKEN_PATH_PREFIXES) {
    const at = lowerPath.indexOf(prefix);
    if (at < 0) continue;
    const start = at + prefix.length;
    const end = decoded.indexOf('/', start);
    pathPart = `${decoded.slice(0, start)}${REDACTED}${end >= 0 ? decoded.slice(end) : ''}`;
    break;
  }
  // Decoding can produce CR/LF and other control characters: never let them reach a plain-text log
  // (log forging, CWE-117).
  pathPart = escapeControlChars(pathPart);

  if (query === null) return `${pathPart}${hash}`;
  const safeQuery = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      return SENSITIVE_PARAM.test(safeDecode(name)) ? `${name}=${REDACTED}` : pair;
    })
    .join('&');
  return `${pathPart}?${safeQuery}${hash}`;
}
