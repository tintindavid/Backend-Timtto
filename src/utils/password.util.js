'use strict';
import bcrypt from 'bcryptjs';

/* hashea una contraseña */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/* compara una contraseña sin hash con una contraseña con hash */
export async function comparePassword(password, hash) {
  console.log('Comparando contraseña con hash:', { password, hash });
  return bcrypt.compare(password, hash);
}
