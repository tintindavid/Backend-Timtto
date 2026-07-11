import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';

/**
 * In-memory cache of compiled Handlebars template functions.
 * Key: template filename (e.g. 'welcome-tenant-admin.hbs').
 * Value: compiled template function returned by Handlebars.compile().
 * Populated lazily on first use; cleared only on process restart.
 */
const cache = new Map();

/**
 * Loads and compiles a Handlebars template from disk.
 * Returns the cached compiled function on subsequent calls.
 *
 * @param {string} name  Filename relative to src/templates/email/ (e.g. 'welcome-tenant-admin.hbs')
 * @returns {Promise<HandlebarsTemplateDelegate>}
 */
async function loadTemplate(name) {
  if (cache.has(name)) return cache.get(name);
  const filePath = path.join(process.cwd(), 'src', 'templates', 'email', name);
  const source = await fs.readFile(filePath, 'utf-8');
  const compiled = Handlebars.compile(source);
  cache.set(name, compiled);
  return compiled;
}

/**
 * Renders a Handlebars template with the given variables.
 *
 * @param {string} name  Template filename (see loadTemplate)
 * @param {object} vars  Template variables
 * @returns {Promise<string>} Rendered string (HTML or plain text)
 */
export async function renderTemplate(name, vars) {
  const compiled = await loadTemplate(name);
  return compiled(vars);
}
