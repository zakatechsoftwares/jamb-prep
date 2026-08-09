import { createHmac, timingSafeEqual } from 'node:crypto';
import { PANEL_ROLES, type PanelRole } from '@jamb/shared';

/**
 * A verified reviewer session, decoded from a signed bearer token. Never
 * constructed except by `parseSessionToken` succeeding — nothing else in
 * this codebase is allowed to fabricate one.
 *
 * `role` is a snapshot taken at login and does not change until the token
 * is re-issued. If a reviewer is promoted or demoted mid-session, that
 * change does not take effect until their current token expires and they
 * log in again — do not assume a role change is immediate. `status`
 * (active/suspended/removed) is not in this payload and is not subject to
 * this lag: it is re-checked against the database on every request via
 * `loadReviewer`, so a suspended reviewer is rejected on their very next
 * request regardless of what their token says.
 */
export interface SessionTokenPayload {
  reviewerId: number;
  role: PanelRole;
  issuedAt: string;
  expiresAt: string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(payloadSegment: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadSegment).digest('base64url');
}

/**
 * Signs `{ reviewerId, role }` into a bearer token good for `ttlMinutes`
 * from `issuedAt`. The clock is injected — see CLAUDE.md's rule against
 * reaching for `new Date()` inside a decision — so signing is reproducible
 * in a test. Callers making a real token pass `new Date()` themselves; this
 * function never reads the clock on its own.
 */
export function signSessionToken(
  payload: { reviewerId: number; role: PanelRole },
  secret: string,
  issuedAt: Date,
  ttlMinutes: number,
): string {
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) {
    throw new Error('signSessionToken: issuedAt must be a valid Date');
  }
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error(
      `signSessionToken: ttlMinutes must be a positive whole number, got ${ttlMinutes}`,
    );
  }

  const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60_000);
  const fullPayload: SessionTokenPayload = {
    reviewerId: payload.reviewerId,
    role: payload.role,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const payloadSegment = base64UrlEncode(JSON.stringify(fullPayload));
  const signatureSegment = sign(payloadSegment, secret);

  return `${payloadSegment}.${signatureSegment}`;
}

/**
 * Verifies a bearer token's signature and expiry against `now`, returning
 * its payload. Throws — never returns a falsy result — on anything wrong:
 * malformed structure, a signature that doesn't match `secret`, or a token
 * whose `expiresAt` has passed as of `now`. Expiry is exclusive: a token is
 * valid up to but not through its `expiresAt` instant.
 *
 * The signature is checked with a constant-time comparison and before any
 * of the payload is trusted or parsed — an attacker who controls the
 * payload segment does not control the signature over it.
 */
export function parseSessionToken(token: unknown, secret: string, now: Date): SessionTokenPayload {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('parseSessionToken: token must be a non-empty string');
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('parseSessionToken: malformed token structure');
  }
  const [payloadSegment, signatureSegment] = parts as [string, string];

  const expectedSignature = Buffer.from(sign(payloadSegment, secret), 'base64url');
  const providedSignature = Buffer.from(signatureSegment, 'base64url');

  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('parseSessionToken: signature does not match');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(payloadSegment));
  } catch {
    throw new Error('parseSessionToken: payload is not valid JSON');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('parseSessionToken: payload must be an object');
  }
  const candidate = raw as Record<string, unknown>;

  if (!Number.isInteger(candidate.reviewerId) || (candidate.reviewerId as number) <= 0) {
    throw new Error('parseSessionToken: payload.reviewerId must be a positive integer');
  }
  if (
    typeof candidate.role !== 'string' ||
    !(PANEL_ROLES as readonly string[]).includes(candidate.role)
  ) {
    throw new Error(`parseSessionToken: payload.role must be one of ${PANEL_ROLES.join(', ')}`);
  }
  if (typeof candidate.issuedAt !== 'string' || Number.isNaN(Date.parse(candidate.issuedAt))) {
    throw new Error('parseSessionToken: payload.issuedAt must be a valid ISO date string');
  }
  if (typeof candidate.expiresAt !== 'string' || Number.isNaN(Date.parse(candidate.expiresAt))) {
    throw new Error('parseSessionToken: payload.expiresAt must be a valid ISO date string');
  }

  if (now.getTime() >= Date.parse(candidate.expiresAt)) {
    throw new Error('parseSessionToken: token has expired');
  }

  return {
    reviewerId: candidate.reviewerId as number,
    role: candidate.role as PanelRole,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
  };
}
