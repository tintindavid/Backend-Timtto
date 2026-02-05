#!/usr/bin/env node
import { connect } from '../src/config/database.js';
import { User } from '../src/models/user.model.js';
import bcrypt from 'bcryptjs';

async function main() {
  const [,, email='martin@acme.com', tenantId='acme', password='martin123'] = process.argv;
  try {
    await connect();
    const user = await User.findOne({ email: email.toLowerCase(), tenantId }).lean();
    if (!user) {
      console.error('User not found');
      process.exit(2);
    }
    console.log('User found:', user._id.toString());
    console.log('Stored password length:', user.password?.length);
    console.log('Stored password preview:', (user.password || '').slice(0,60));
    const match = await bcrypt.compare(password, user.password || '');
    console.log('bcrypt.compare result:', match);
    process.exit(0);
  } catch (err) {
    console.error('Error in debug-compare', err);
    process.exit(3);
  }
}

main();
