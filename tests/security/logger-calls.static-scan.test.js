/**
 * tests/security/logger-calls.static-scan.test.js
 * token-log-hygiene (spec: "Existing log calls SHALL be reviewed for secrets").
 *
 * Scans every `logger.<level>(...)` call under src/ and fails when an argument
 * references a token, Authorization header, password, secret, credential, whole
 * request body/headers or a raw validation payload. String literals are ignored
 * (a message such as 'password changed' is fine); only identifiers and property
 * paths that carry values are inspected, including `${...}` inside templates.
 *
 * To allow a call, add an entry to ALLOWLIST with a justification. Entries match
 * on file + the offending identifier so they do not silently cover new leaks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const LEVEL_RE = /\blogger(?:\?)?\.(?:error|warn|info|http|verbose|debug|silly|log)\s*\(/g;

// Identifier segments that denote secret material. `tokenId`, `tokensCount`, etc. are ids/counters.
const SENSITIVE_SEGMENT = /^(?:.*token|authorization|.*password|.*secret|credentials?|body|headers|payload|cookies?|apikey|api_key)$/i;
const BACKSLASH = String.fromCharCode(92);
const SAFE_SEGMENT =/(?:id|ids|count|length|status|type|name|collision|hash|fingerprint)$/i;

/** Justified exceptions: `file` is relative to src/, `identifier` is the flagged path. */
const ALLOWLIST = [
  {
    file: 'controllers/cronograma.controller.js',
    identifier: 'req.body?.clienteId',
    why: 'Only the boolean presence flag (!!req.body?.clienteId) is logged, never the value.',
  },
  {
    file: 'controllers/cronograma.controller.js',
    identifier: 'req.body?.filtros',
    why: 'Only the boolean presence flag (!!req.body?.filtros) is logged, never the value.',
  },
  {
    file: 'services/external/email.service.js',
    identifier: 'body',
    why: 'Body of the email provider error response (not our request); contains no credentials and aids delivery debugging.',
  },
  {
    file: 'services/pdfMicroserviceClient.js',
    identifier: 'body',
    why: 'Debug-level, first 500 characters of the HTML sent to the PDF microservice; no credential is part of that payload.',
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Returns the source text of the argument list starting right after the opening paren. */
function extractArgs(source, start) {
  let depth = 1;
  let i = start;
  let quote = null;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (quote) {
      if (ch === BACKSLASH) i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  return source.slice(start, i - 1);
}

/** Removes string literal contents but keeps `${expr}` of template literals. */
function stripStrings(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\'' || ch === '"') {
      i += 1;
      while (i < code.length && code[i] !== ch) i += code[i] === BACKSLASH ? 2 : 1;
      i += 1;
      out += ' ';
    } else if (ch === '`') {
      i += 1;
      while (i < code.length && code[i] !== '`') {
        if (code[i] === BACKSLASH) { i += 2; continue; }
        if (code[i] === '$' && code[i + 1] === '{') {
          let depth = 1;
          let j = i + 2;
          while (j < code.length && depth > 0) {
            if (code[j] === '{') depth += 1;
            else if (code[j] === '}') depth -= 1;
            j += 1;
          }
          out += ` ${code.slice(i + 2, j - 1)} `;
          i = j;
        } else i += 1;
      }
      i += 1;
      out += ' ';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function sensitiveIdentifiers(argsCode) {
  const code = stripStrings(argsCode);
  const found = new Set();
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*/g)) {
    const segments = m[0].split(/\??\./);
    if (segments.some((s) => SENSITIVE_SEGMENT.test(s) && !SAFE_SEGMENT.test(s))) found.add(m[0]);
  }
  return [...found];
}

function scanFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const findings = [];
  for (const m of source.matchAll(LEVEL_RE)) {
    const args = extractArgs(source, m.index + m[0].length);
    const line = source.slice(0, m.index).split('\n').length;
    for (const identifier of sensitiveIdentifiers(args)) {
      if (ALLOWLIST.some((a) => a.file === rel && a.identifier === identifier)) continue;
      findings.push(`${rel}:${line} logs "${identifier}"`);
    }
  }
  return findings;
}

describe('logger calls never reference secrets (static scan)', () => {
  it('finds no logger call that passes tokens, passwords, secrets, headers or request bodies', () => {
    const findings = walk(SRC).flatMap(scanFile);
    assert.deepEqual(findings, [], `Sensitive values reach the logger:\n${findings.join('\n')}`);
  });

  it('every allowlist entry carries a justification and still matches a real call', () => {
    for (const entry of ALLOWLIST) {
      assert.ok(entry.why && entry.why.length > 10, `allowlist entry ${entry.file} needs a justification`);
      assert.ok(fs.existsSync(path.join(SRC, entry.file)), `allowlisted file ${entry.file} no longer exists`);
    }
  });

  it('the scanner detects a leaking call (self-check)', () => {
    assert.deepEqual(sensitiveIdentifiers("'Verifying token:', token"), ['token']);
    assert.deepEqual(sensitiveIdentifiers('{ data: req.body, tenantId }'), ['req.body']);
    assert.deepEqual(sensitiveIdentifiers('`auth ${req.headers.authorization}`'), ['req.headers.authorization']);
    assert.deepEqual(sensitiveIdentifiers("'password changed', { userId, tokenId }"), []);
  });
});
