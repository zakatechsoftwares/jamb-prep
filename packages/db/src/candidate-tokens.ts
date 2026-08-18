import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A verified candidate session, decoded from a signed bearer token. Never
 * constructed except by `parseCandidateToken` succeeding.
 *
 * Deliberately not `SessionTokenPayload` with a different id name — a
 * candidate is a structurally different actor from a reviewer, not a
 * reviewer wearing a different role. `userId` is a `users.id` directly:
 * unlike a reviewer (`reviewers.id` resolving to `users.id` via
 * `loadReviewer`), there is no separate candidate profile table to check
 * an active/suspended status against, so this payload carries nothing
 * beyond identity and expiry.
 */
export interface CandidateTokenPayload {
  userId: number;
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
 * Signs `{ userId }` into a bearer token good for `ttlMinutes` from
 * `issuedAt`. The clock is injected, matching `signSessionToken`'s own
 * discipline, so signing is reproducible in a test.
 */
export function signCandidateToken(
  payload: { userId: number },
  secret: string,
  issuedAt: Date,
  ttlMinutes: number,
): string {
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) {
    throw new Error('signCandidateToken: issuedAt must be a valid Date');
  }
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error(
      `signCandidateToken: ttlMinutes must be a positive whole number, got ${ttlMinutes}`,
    );
  }

  const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60_000);
  const fullPayload: CandidateTokenPayload = {
    userId: payload.userId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const payloadSegment = base64UrlEncode(JSON.stringify(fullPayload));
  const signatureSegment = sign(payloadSegment, secret);

  return `${payloadSegment}.${signatureSegment}`;
}

/**
 * Verifies a bearer token's signature and expiry against `now`, returning
 * its payload. Throws on anything wrong, exactly like `parseSessionToken`:
 * malformed structure, a mismatched signature, or an expired token
 * (exclusive — valid up to but not through `expiresAt`).
 */
export function parseCandidateToken(token: unknown, secret: string, now: Date): CandidateTokenPayload {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('parseCandidateToken: token must be a non-empty string');
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('parseCandidateToken: malformed token structure');
  }
  const [payloadSegment, signatureSegment] = parts as [string, string];

  const expectedSignature = Buffer.from(sign(payloadSegment, secret), 'base64url');
  const providedSignature = Buffer.from(signatureSegment, 'base64url');

  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('parseCandidateToken: signature does not match');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(payloadSegment));
  } catch {
    throw new Error('parseCandidateToken: payload is not valid JSON');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('parseCandidateToken: payload must be an object');
  }
  const candidate = raw as Record<string, unknown>;

  if (!Number.isInteger(candidate.userId) || (candidate.userId as number) <= 0) {
    throw new Error('parseCandidateToken: payload.userId must be a positive integer');
  }
  if (typeof candidate.issuedAt !== 'string' || Number.isNaN(Date.parse(candidate.issuedAt))) {
    throw new Error('parseCandidateToken: payload.issuedAt must be a valid ISO date string');
  }
  if (typeof candidate.expiresAt !== 'string' || Number.isNaN(Date.parse(candidate.expiresAt))) {
    throw new Error('parseCandidateToken: payload.expiresAt must be a valid ISO date string');
  }

  if (now.getTime() >= Date.parse(candidate.expiresAt)) {
    throw new Error('parseCandidateToken: token has expired');
  }

  return {
    userId: candidate.userId as number,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
  };
}
