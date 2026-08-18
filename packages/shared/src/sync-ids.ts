/**
 * A v4-shaped UUID generator built on an injected `random`, not `crypto.randomUUID` —
 * `apps/mobile` runs on Hermes, where a global `crypto.randomUUID` is not a
 * safe assumption, and CLAUDE.md's own rule against reaching for ambient
 * randomness inside a decision applies here too: this is what lets the
 * output be pinned in a test. Used for both a session's `clientSessionId`
 * and each attempt's `idempotencyKey` (plan 8.3's offline-first sync keys) —
 * collision-resistance only needs to hold within one device's own usage,
 * not cryptographic unguessability, so drawing from the injected generator
 * is a deliberate, sufficient choice, not a shortcut.
 */
export function generateSyncId(random: () => number): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new Error(`generateSyncId: the random generator must return a draw in [0, 1), but returned ${draw}`);
    }
    bytes.push(Math.floor(draw * 256));
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx

  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
