/**
 * csvBuilder.util.js — lightweight server-side CSV generation per design D5.
 *
 * RFC 4180 escaping rules:
 *   - Values containing commas, double-quotes, newlines (\n) or carriage
 *     returns (\r) are wrapped in double-quote pairs.
 *   - Double-quote characters inside a quoted value are escaped by doubling them.
 *   - null/undefined values are serialized as an empty string.
 */

/**
 * Escapes a single cell value per RFC 4180.
 *
 * @param {string} s  Already converted to string (caller responsibility).
 * @returns {string}
 */
function escape(s) {
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Builds a CSV string from an array of plain objects.
 *
 * @param {Array<object>} rows    Data rows. Each object must have the keys
 *                                referenced by `columns`.
 * @param {Array<{key: string, label: string}>} columns
 *                                Column descriptors. `label` becomes the header;
 *                                `key` is the property name read from each row.
 * @returns {string}  Complete CSV string (header + rows, no trailing newline).
 *                    Does NOT include the BOM — callers prepend it if needed.
 */
export function buildCsv(rows, columns) {
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((c) => escape(String(row[c.key] ?? '')))
        .join(','),
    )
    .join('\n');
  return body.length > 0 ? `${header}\n${body}` : header;
}
