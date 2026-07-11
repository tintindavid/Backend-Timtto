/**
 * seed-platform-superadmin.js
 *
 * Idempotent seed — E0 saas-security-baseline.
 *
 * Creates the first platform SuperAdmin user if it does not already exist.
 * If a user with the given email and role='superadmin' already exists, exits
 * cleanly without making any changes.
 *
 * Required env vars:
 *   MONGO_URI                  — MongoDB connection string
 *   SEED_SUPERADMIN_EMAIL      — Email for the SuperAdmin account
 *   SEED_SUPERADMIN_PASSWORD   — Plain-text password (will be hashed by the User model pre-save hook)
 *
 * Usage:
 *   MONGO_URI=mongodb://... \
 *   SEED_SUPERADMIN_EMAIL=ops@timtto.com \
 *   SEED_SUPERADMIN_PASSWORD=ChangeMe123! \
 *   node scripts/seed-platform-superadmin.js
 */

import mongoose from 'mongoose';
import { User } from '../src/models/user.model.js';

const MONGO_URI = process.env.MONGO_URI;
const SEED_EMAIL = process.env.SEED_SUPERADMIN_EMAIL;
const SEED_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD;

if (!MONGO_URI) {
  console.error('[seed-platform-superadmin] MONGO_URI env var is required');
  process.exit(1);
}
if (!SEED_EMAIL) {
  console.error('[seed-platform-superadmin] SEED_SUPERADMIN_EMAIL env var is required');
  process.exit(1);
}
if (!SEED_PASSWORD) {
  console.error('[seed-platform-superadmin] SEED_SUPERADMIN_PASSWORD env var is required');
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('[seed-platform-superadmin] Connected to MongoDB');

  // Check idempotency: if a superadmin with this email already exists, do nothing.
  const existing = await User.findOne(
    { email: SEED_EMAIL.toLowerCase(), role: 'superadmin' },
  ).setOptions({ includeDeleted: true }).lean();

  if (existing) {
    console.log(`[seed-platform-superadmin] SuperAdmin ${SEED_EMAIL} already exists — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  // Create the superadmin. The pre-save hook on User will hash the password.
  const superAdmin = await User.create({
    tenantId: '__platform__',
    email: SEED_EMAIL.toLowerCase(),
    password: SEED_PASSWORD,
    role: 'superadmin',
    firstName: 'Platform',
    lastName: 'SuperAdmin',
  });

  console.log(`[seed-platform-superadmin] Created SuperAdmin: ${superAdmin.email} (${superAdmin._id})`);
  console.log('[seed-platform-superadmin] IMPORTANT: Change the password immediately after first login.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed-platform-superadmin] Fatal error:', err);
  process.exit(1);
});
