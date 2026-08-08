/**
 * NOT YET IMPLEMENTED — tests first, per CLAUDE.md.
 *
 * Hashes a password with a random per-password salt, using Node's built-in
 * `scrypt` — no dependency added for this. Returns a single self-describing
 * string (`scrypt$<saltHex>$<hashHex>`) so `verifyPassword` needs nothing
 * else stored alongside it.
 */
export function hashPassword(_password: string): string {
  return '';
}

/**
 * NOT YET IMPLEMENTED — tests first, per CLAUDE.md.
 *
 * Verifies `password` against a hash previously produced by `hashPassword`.
 * Returns false — never throws — for a wrong password or a malformed
 * stored hash: a login attempt that doesn't verify is an ordinary outcome,
 * not a caller bug.
 */
export function verifyPassword(_password: string, _stored: string): boolean {
  return false;
}
