/**
 * Minimal in-memory stand-in for the Mongoose statics used by the dashboard services (DB-free tests): a Mongo-like
 * matcher (equality, null, $in/$nin/$ne/$gte/$lt/$exists, $or/$and, ObjectId-as-string comparison) and a tiny
 * aggregation interpreter ($match, $group with $sum/$max, $sort, $limit, $count). Every call is recorded so a test can
 * assert that EVERY query carried the tenant.
 */

const str = (v) => (v && typeof v === 'object' && !(v instanceof Date) && typeof v.toString === 'function' ? v.toString() : v);
const norm = (v) => (v instanceof Date ? v.getTime() : str(v));
const isNil = (v) => v === null || v === undefined;

export function getPath(doc, path) {
  return path.split('.').reduce((acc, key) => (isNil(acc) ? undefined : acc[key]), doc);
}

function condMatch(actual, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(typeof cond.toHexString === 'function')
    && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$in': return arg.some((a) => (isNil(a) ? isNil(actual) : norm(a) === norm(actual)));
        case '$nin': return !arg.some((a) => (isNil(a) ? isNil(actual) : norm(a) === norm(actual)));
        case '$ne': return norm(arg) !== norm(actual);
        case '$gte': return !isNil(actual) && norm(actual) >= norm(arg);
        case '$lt': return !isNil(actual) && norm(actual) < norm(arg);
        case '$exists': return (actual !== undefined) === Boolean(arg);
        default: throw new Error(`fake db: unsupported operator ${op}`);
      }
    });
  }
  if (isNil(cond)) return isNil(actual);
  return norm(actual) === norm(cond);
}

export function matchDoc(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matchDoc(doc, f));
    if (key === '$and') return cond.every((f) => matchDoc(doc, f));
    return condMatch(getPath(doc, key), cond);
  });
}

function evalExpr(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$')) return getPath(doc, expr.slice(1));
  if (expr && typeof expr === 'object' && !(expr instanceof Date) && !Array.isArray(expr)) {
    if (expr.$ifNull) {
      const [a, b] = expr.$ifNull;
      const va = evalExpr(a, doc);
      return isNil(va) ? evalExpr(b, doc) : va;
    }
    return Object.fromEntries(Object.entries(expr).map(([k, v]) => [k, evalExpr(v, doc)]));
  }
  return expr;
}

export function runPipeline(rows, pipeline) {
  let docs = rows;
  for (const stage of pipeline) {
    const [op, arg] = Object.entries(stage)[0];
    if (op === '$match') docs = docs.filter((d) => matchDoc(d, arg));
    else if (op === '$group') {
      const groups = new Map();
      for (const d of docs) {
        const id = evalExpr(arg._id, d);
        const key = JSON.stringify(id, (_k, v) => (v && typeof v.toHexString === 'function' ? v.toHexString() : v));
        let g = groups.get(key);
        if (!g) { g = { _id: id }; groups.set(key, g); }
        for (const [field, acc] of Object.entries(arg)) {
          if (field === '_id') continue;
          if (acc.$sum !== undefined) g[field] = (g[field] || 0) + (typeof acc.$sum === 'number' ? acc.$sum : Number(evalExpr(acc.$sum, d)) || 0);
          else if (acc.$max !== undefined) {
            const v = evalExpr(acc.$max, d);
            if (!isNil(v) && (isNil(g[field]) || v > g[field])) g[field] = v;
            else if (!(field in g)) g[field] = null;
          } else throw new Error('fake db: unsupported accumulator');
        }
      }
      docs = [...groups.values()];
    } else if (op === '$count') docs = docs.length ? [{ [arg]: docs.length }] : [];
    else if (op === '$sort') {
      const entries = Object.entries(arg);
      docs = [...docs].sort((a, b) => {
        for (const [f, dir] of entries) {
          const va = norm(getPath(a, f)); const vb = norm(getPath(b, f));
          if (va === vb) continue;
          return (va > vb ? 1 : -1) * dir;
        }
        return 0;
      });
    } else if (op === '$limit') docs = docs.slice(0, arg);
    else throw new Error(`fake db: unsupported stage ${op}`);
  }
  return docs;
}

function sortDocs(docs, spec) {
  if (!spec) return docs;
  return [...docs].sort((a, b) => {
    for (const [f, dir] of Object.entries(spec)) {
      const va = getPath(a, f); const vb = getPath(b, f);
      const na = isNil(va) ? -Infinity : norm(va); const nb = isNil(vb) ? -Infinity : norm(vb);
      if (na === nb) continue;
      return (na > nb ? 1 : -1) * dir;
    }
    return 0;
  });
}

/**
 * Patches `find`, `countDocuments`, `aggregate` and `distinct` of every model in `models` ({ Model: rows }).
 * @returns {{ calls: Array<{model:string, op:string, filter:any}>, restore: () => void }}
 */
export function installFakeDb(models) {
  const calls = [];
  const restores = [];
  for (const [name, { Model, rows }] of Object.entries(models)) {
    const original = {
      find: Model.find, countDocuments: Model.countDocuments, aggregate: Model.aggregate, distinct: Model.distinct,
    };
    Model.find = (filter = {}) => {
      calls.push({ model: name, op: 'find', filter });
      const state = {};
      const q = {
        select: () => q, populate: () => q, lean: () => q,
        sort: (s) => { state.sort = s; return q; },
        limit: (n) => { state.limit = n; return q; },
        then: (res, rej) => Promise.resolve().then(() => {
          let docs = sortDocs(rows.filter((d) => matchDoc(d, filter)), state.sort);
          if (state.limit) docs = docs.slice(0, state.limit);
          return docs;
        }).then(res, rej),
      };
      return q;
    };
    Model.countDocuments = async (filter = {}) => { calls.push({ model: name, op: 'count', filter }); return rows.filter((d) => matchDoc(d, filter)).length; };
    Model.aggregate = async (pipeline) => { calls.push({ model: name, op: 'aggregate', filter: pipeline[0].$match }); return runPipeline(rows, pipeline); };
    Model.distinct = async (field, filter = {}) => { calls.push({ model: name, op: 'distinct', filter }); return rows.filter((d) => matchDoc(d, filter)).map((d) => d[field]); };
    restores.push(() => Object.assign(Model, original));
  }
  return { calls, restore: () => restores.forEach((r) => r()) };
}
