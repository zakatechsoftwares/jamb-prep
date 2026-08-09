import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Hashes a password with a random per-password salt, using Node's built-in
 * `scrypt` — no dependency added for this. Returns a single self-describing
 * string (`scrypt$<saltHex>$<hashHex>`) so `verifyPassword` needs nothing
 * else stored alongside it.
 */
export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword: password must be a non-empty string');
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_BYTES);

  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifies `password` against a hash previously produced by `hashPassword`.
 * Returns false — never throws — for a wrong password or a malformed
 * stored hash: a login attempt that doesn't verify is an ordinary outcome,
 * not a caller bug.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== 'string' || typeof stored !== 'string') {
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, saltHex, hashHex] = parts as [string, string, string];

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
