/**
 * Pure bipartite matching used by the approval engine: can every approval level get a DISTINCT approver?
 * (Separation of duties: one person may decide only one level of a requisition, so a person that is the only
 * eligible approver of two levels makes the second one undecidable.)
 *
 * @param {{ key: string|number, ids: string[] }[]} levels  eligible user ids per level
 * @returns {{ feasible: boolean, assignment: Map<string|number, string>, offending: (string|number)[] }}
 *   `offending`: levels that cannot be satisfied (empty sets, or the Hall-violating group of levels that compete
 *   for too few people).
 */
export function findDistinctAssignment(levels) {
  const sets = new Map(levels.map((l) => [l.key, [...new Set((l.ids || []).map(String))]]));
  const ownerOf = new Map(); // userId -> level key
  const levelOf = new Map(); // level key -> userId

  const tryAssign = (key, seen) => {
    for (const uid of sets.get(key)) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      if (!ownerOf.has(uid) || tryAssign(ownerOf.get(uid), seen)) {
        ownerOf.set(uid, key);
        levelOf.set(key, uid);
        return true;
      }
    }
    return false;
  };

  const unmatched = [];
  for (const { key } of levels) {
    if (!tryAssign(key, new Set())) unmatched.push(key);
  }
  if (unmatched.length === 0) return { feasible: true, assignment: levelOf, offending: [] };

  // Hall violator: levels reachable by alternating paths from the unmatched ones.
  const offending = new Set();
  const visitedUsers = new Set();
  const queue = [...unmatched];
  while (queue.length > 0) {
    const key = queue.shift();
    if (offending.has(key)) continue;
    offending.add(key);
    for (const uid of sets.get(key)) {
      if (visitedUsers.has(uid)) continue;
      visitedUsers.add(uid);
      if (ownerOf.has(uid)) queue.push(ownerOf.get(uid));
    }
  }
  const order = levels.map((l) => l.key);
  return { feasible: false, assignment: levelOf, offending: order.filter((k) => offending.has(k)) };
}
