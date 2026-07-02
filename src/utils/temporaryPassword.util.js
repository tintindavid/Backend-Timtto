import crypto from 'crypto';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

/**
 * Picks a single random character from a charset using crypto.randomBytes.
 * Uses 4 bytes (uint32) to minimise modulo bias for charsets shorter than 2^32.
 */
function pickRandom(charset) {
  return charset[crypto.randomBytes(4).readUInt32BE(0) % charset.length];
}

/**
 * Generates a cryptographically secure temporary password.
 *
 * Guarantees:
 * - Length ≥ 12 characters (default 14)
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one symbol from the set !@#$%^&*()_+-=[]{}|;:,.<>?
 *
 * @param {number} [length=14] Total length (enforced minimum: 12)
 * @returns {string}
 */
export function generateTemporaryPassword(length = 14) {
  const effectiveLength = Math.max(length, 12);

  // Guarantee one character from each required class
  const required = [
    pickRandom(UPPERCASE),
    pickRandom(LOWERCASE),
    pickRandom(DIGITS),
    pickRandom(SYMBOLS),
  ];

  // Fill the rest from the full alphabet
  const extra = Array.from(
    { length: effectiveLength - required.length },
    () => pickRandom(ALL_CHARS),
  );

  const combined = [...required, ...extra];

  // Fisher-Yates shuffle using crypto bytes for each swap index
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(4).readUInt32BE(0) % (i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
}
