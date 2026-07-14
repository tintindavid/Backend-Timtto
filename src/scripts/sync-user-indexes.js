'use strict';

/**
 * One-shot: rebuilds the User collection indexes so the unique (tenantId, email)
 * constraint applies only to live rows (isDeleted:false). Without this, a soft-
 * deleted user still blocks re-creation with the same email — but they don't
 * show up in the /users listing, so the operator sees a mismatch between the
 * error message and reality.
 *
 * Safe to re-run: `syncIndexes` diffs the collection's current indexes against
 * the schema and only drops/creates what changed.
 *
 * Run: `node src/scripts/sync-user-indexes.js`
 */

import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';

async function main() {
  await mongoose.connect(env.MONGO_URI || env.DATABASE_URL);
  console.log('Connected. Syncing indexes on users collection...');
  const dropped = await User.syncIndexes();
  console.log('syncIndexes result:', dropped);
  const indexes = await User.collection.indexes();
  console.log('Current indexes:');
  for (const idx of indexes) {
    console.log(' -', idx.name, JSON.stringify(idx.key), idx.partialFilterExpression ? `partial=${JSON.stringify(idx.partialFilterExpression)}` : '');
  }
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
