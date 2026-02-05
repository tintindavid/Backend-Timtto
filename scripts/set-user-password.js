#!/usr/bin/env node
import { connect } from '../src/config/database.js';
import { User } from '../src/models/user.model.js';
import bcrypt from 'bcryptjs';

async function main() {
  const [,, email, tenantId, password] = process.argv;
  if (!email || !tenantId || !password) {
    console.error('Usage: node scripts/set-user-password.js <email> <tenantId> <password>');
    process.exit(1);
  }

  try {
    await connect();
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);
    const user = await User.findOneAndUpdate({ email: email.toLowerCase(), tenantId }, { $set: { password: hashed } }, { new: true });
    if (!user) {
      console.error('User not found');
      process.exit(2);
    }
    console.log(`Updated user ${user._id.toString()}`);
    process.exit(0);
  } catch (err) {
    console.error('Error updating password', err);
    process.exit(3);
  }
}

main();
