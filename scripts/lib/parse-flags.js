/**
 * Strict flag parser of the requisitions scripts. A typo such as `--dryrun` must NEVER fall back to the default (which writes):
 * every unknown flag, an empty `--tenant=` and a value on a boolean flag are errors (the caller prints the usage and exits 2).
 *
 * @param {string[]} argv        arguments after the script name
 * @param {{ boolean?: string[], value?: string[] }} spec  accepted flags (without the leading `--`)
 * @returns {Record<string, string|boolean>}
 */
export function parseFlags(argv, { boolean = [], value = [] } = {}) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`Argumento no reconocido: ${arg}`);
    const [, name, val] = m;
    if (boolean.includes(name)) {
      if (val !== undefined) throw new Error(`La opción --${name} no recibe valor`);
      out[name] = true;
    } else if (value.includes(name)) {
      if (val === undefined || val.trim() === '') throw new Error(`La opción --${name} requiere un valor no vacío`);
      out[name] = val.trim();
    } else {
      throw new Error(`Opción desconocida: --${name}`);
    }
  }
  return out;
}

/** Parses `process.argv` or prints the usage and exits with code 2 (nothing has been touched yet). */
export function parseFlagsOrExit(spec, usage, argv = process.argv.slice(2)) {
  try {
    return parseFlags(argv, spec);
  } catch (err) {
    console.error(`${err.message}\nUso: ${usage}`);
    process.exit(2);
    return {};
  }
}
