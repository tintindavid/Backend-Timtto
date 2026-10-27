/**
 * Tiny in-memory stand-in for the Mongoose model statics the services use (DB-free tests, project convention).
 * It honours tenantId/_id equality, $in, $ne, $regex, $exists, $or and the soft-delete hook (isDeleted rows are
 * hidden unless `.setOptions({ includeDeleted: true })`), and supports the chainable query API as a thenable.
 */

function opMatch(actual, cond) {
  if (cond instanceof RegExp) return cond.test(String(actual));
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    for (const [op, arg] of Object.entries(cond)) {
      if (op === '$in' && !arg.map(String).includes(String(actual))) return false;
      if (op === '$ne' && String(actual) === String(arg)) return false;
      if (op === '$exists' && (actual !== undefined) !== Boolean(arg)) return false;
      if (op === '$regex') {
        const rx = new RegExp(arg, cond.$options);
        if (!rx.test(String(actual))) return false;
      }
    }
    return true;
  }
  if (Array.isArray(actual)) return actual.map(String).includes(String(cond));
  return String(actual) === String(cond);
}

export function matches(doc, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$or') {
      if (!v.some((f) => matches(doc, f))) return false;
    } else if (!opMatch(doc[k], v)) return false;
  }
  return true;
}

function makeQuery(getResult) {
  const state = { opts: {} };
  const q = {
    sort: (s) => { state.sort = s; return q; },
    skip: (n) => { state.skip = n; return q; },
    limit: (n) => { state.limit = n; return q; },
    select: () => q,
    lean: () => q,
    setOptions: (o) => { Object.assign(state.opts, o); return q; },
    then: (res, rej) => Promise.resolve().then(() => getResult(state)).then(res, rej),
  };
  return q;
}

/**
 * @param {import('mongoose').Model} Model
 * @param {object[]} rows  backing store (mutated by create / findOneAndUpdate)
 * @returns {() => void} restore function
 */
export function stubModel(Model, rows, { onCreate } = {}) {
  const saved = {};
  const names = ['find', 'findOne', 'countDocuments', 'exists', 'create', 'findOneAndUpdate'];
  for (const n of names) saved[n] = Model[n];
  let seq = 0;
  const visible = (state) => (d) => state.opts.includeDeleted || !d.isDeleted;
  const withJson = (d) => Object.assign(d, { toJSON() { return { ...this }; } });

  Model.find = (filter) => makeQuery((state) => {
    let out = rows.filter(visible(state)).filter((d) => matches(d, filter));
    if (state.sort) {
      const [[key, dir]] = Object.entries(state.sort);
      out = [...out].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
    }
    if (state.skip) out = out.slice(state.skip);
    if (state.limit) out = out.slice(0, state.limit);
    return out.map((d) => ({ ...d }));
  });
  Model.findOne = (filter) => makeQuery((state) => {
    const hit = rows.filter(visible(state)).find((d) => matches(d, filter));
    return hit ? withJson(hit) : null;
  });
  Model.countDocuments = (filter) => makeQuery((state) => rows.filter(visible(state)).filter((d) => matches(d, filter)).length);
  Model.exists = (filter) => makeQuery((state) => {
    const hit = rows.filter(visible(state)).find((d) => matches(d, filter));
    return hit ? { _id: hit._id } : null;
  });
  Model.create = async (data) => {
    const doc = withJson({ _id: `id${++seq}`, isDeleted: false, ...data });
    if (onCreate) onCreate(doc);
    rows.push(doc);
    return doc;
  };
  Model.findOneAndUpdate = (filter, update) => makeQuery((state) => {
    const hit = rows.filter(visible(state)).find((d) => matches(d, filter));
    if (!hit) return null;
    Object.assign(hit, update.$set || {});
    return withJson(hit);
  });

  return () => { for (const n of names) Model[n] = saved[n]; };
}
