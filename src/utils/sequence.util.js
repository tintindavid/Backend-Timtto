import { Counter } from '../models/counter.model.js';

export async function getNextSequence(tenantId, key) {
  const res = await Counter.findOneAndUpdate(
    { tenantId, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  return res.seq;
}

export function formatConsecutivo(prefix, number, pad = 6) {
  return `${prefix}${String(number).padStart(pad, '0')}`;
}
