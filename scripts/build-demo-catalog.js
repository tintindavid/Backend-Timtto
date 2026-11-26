/**
 * Builds the base catalogue of the demo accounts from a catalogue export of one tenant. Offline: it only reads files.
 *
 *   node scripts/build-demo-catalog.js --tenant=<tenantId> --dry-run
 *   node scripts/build-demo-catalog.js --tenant=<tenantId> [--input=../datos-produccion]
 *
 * Review the texts of the generated file before committing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATALOG_PATH, parseExport, sanitizeCatalog, itemsConProtocolo } from '../src/services/demo/demoCatalog.js';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || fallback;
const unknown = args.filter((a) => a !== '--dry-run' && !a.startsWith('--input=') && !a.startsWith('--tenant='));
if (unknown.length) throw new Error(`Argumento desconocido: ${unknown.join(', ')}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(option('input', path.join(here, '../../datos-produccion')));
const tenantId = option('tenant', '');
if (!tenantId) throw new Error('Indica el tenant de origen con --tenant=<tenantId>');
const files = fs.readdirSync(input);

/** Accepts `<collection>.json` or `<database>.<collection>.json`. */
function readCollection(collection, { optional = false } = {}) {
  const file = files.find((f) => f === `${collection}.json` || f.endsWith(`.${collection}.json`));
  if (!file) {
    if (optional) return [];
    throw new Error(`Falta el archivo de la colección ${collection} en ${input}`);
  }
  return parseExport(fs.readFileSync(path.join(input, file), 'utf8'));
}

const { catalog, discarded } = sanitizeCatalog({
  items: readCollection('itemss'),
  actividades: readCollection('actividad-mttos'),
  protocolos: readCollection('protocolo-mttos'),
  protocoloActividades: readCollection('protocolo-actividads', { optional: true }),
}, { tenantId });

console.log(`Tenant de origen: ${tenantId}`);
console.log(`Ítems: ${catalog.items.length} (con protocolo utilizable: ${itemsConProtocolo(catalog).length})`);
console.log(`Protocolos: ${catalog.protocolos.length} · Actividades: ${catalog.actividades.length}`);
const foreign = discarded.filter((d) => d.reason === 'otro tenant').length;
console.log(`Registros de otros tenants ignorados: ${foreign}`);
for (const d of discarded.filter((x) => x.reason !== 'otro tenant')) console.log(`- ${d.type} "${d.name}": ${d.reason}`);

if (itemsConProtocolo(catalog).length === 0) throw new Error('El catálogo no tiene ítems con protocolo: no se escribe nada.');
if (args.includes('--dry-run')) {
  console.log('Simulación: no se escribió ningún archivo.');
} else {
  fs.mkdirSync(path.dirname(DEFAULT_CATALOG_PATH), { recursive: true });
  fs.writeFileSync(DEFAULT_CATALOG_PATH, `${JSON.stringify(catalog, null, 1)}\n`);
  console.log(`Escrito: ${DEFAULT_CATALOG_PATH}`);
}
