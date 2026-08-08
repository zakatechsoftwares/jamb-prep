import type { PanelRole } from '@jamb/shared';

/**
 * A verified reviewer session, decoded from a signed bearer token. Never
 * constructed except by `parseSessionToken` succeeding — nothing else in
 * this codebase is allowed to fabricate one.
 */
export interface SessionTokenPayload {
  reviewerId: number;
  role: PanelRole;
  issuedAt: string;
  expiresAt: string;
}

/**
 * NOT YET IMPLEMENTED — tests first, per CLAUDE.md.
 *
 * Signs `{ reviewerId, role }` into a bearer token good for `ttlMinutes`
 * from `issuedAt`. The clock is injected — see CLAUDE.md's rule against
 * reaching for `new Date()` inside a decision — so signing is reproducible
 * in a test.
 */
export function signSessionToken(
  _payload: { reviewerId: number; role: PanelRole },
  _secret: string,
  _issuedAt: Date,
  _ttlMinutes: number,
): string {
  return '';
}

/**
 * NOT YET IMPLEMENTED — tests first, per CLAUDE.md.
 *
 * Verifies a bearer token's signature and expiry against `now`, returning
 * its payload. Throws — never returns a falsy result — on anything wrong:
 * malformed structure, a signature that doesn't match `secret`, or a token
 * whose `expiresAt` has passed as of `now`.
 */
export function parseSessionToken(
  _token: unknown,
  _secret: string,
  _now: Date,
): SessionTokenPayload {
  throw new Error('not yet implemented');
}
