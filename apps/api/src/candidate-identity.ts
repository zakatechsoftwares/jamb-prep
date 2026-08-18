import type { Request } from 'express';
import { parseCandidateToken } from '@jamb/db/candidate-tokens';

/**
 * The candidate-side mirror of `reviewer-identity.ts`. A separate secret
 * and a separate token shape on purpose — a candidate is a structurally
 * different actor from a reviewer (a `users.id` directly, no role, no
 * separate active/suspended status to recheck), not a reviewer wearing a
 * different hat.
 */
export function candidateSessionSecret(): string {
  const secret = process.env.CANDIDATE_SESSION_SECRET;
  if (!secret) {
    throw new Error('CANDIDATE_SESSION_SECRET is not set');
  }
  return secret;
}

/**
 * Returns the candidate's `users.id` carried by the current request's
 * bearer token, or null for anything that isn't a currently-valid session:
 * no header, a malformed header, an unparseable token, a bad signature, or
 * an expired token — `parseCandidateToken` throws on all of those; this is
 * the one place that turns "throws" into "no session."
 */
export function resolveCandidateId(req: Request): number | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  try {
    return parseCandidateToken(token, candidateSessionSecret(), new Date()).userId;
  } catch {
    return null;
  }
}
