import type { NextFunction, Request, Response } from 'express';
import { parseSessionToken, type SessionTokenPayload } from '@jamb/db/session-tokens';

/**
 * Reads the signing secret lazily, on every call, rather than once at
 * module load. A top-level `process.env.REVIEWER_SESSION_SECRET` read would
 * be evaluated the instant this module is imported — before a test or the
 * real entrypoint has had a chance to set it — so every caller goes through
 * this function instead.
 */
function sessionSecret(): string {
  const secret = process.env.REVIEWER_SESSION_SECRET;
  if (!secret) {
    throw new Error('REVIEWER_SESSION_SECRET is not set');
  }
  return secret;
}

/**
 * The single place a request's reviewer session is derived. Every
 * reviewer-facing route in `apps/api` calls this (directly or through
 * `resolveReviewerId`) — never the `Authorization` header itself — so a
 * future change to how the token travels is a one-line change here instead
 * of five.
 *
 * Returns null for anything that isn't a currently-valid session: no
 * header, a malformed header, an unparseable token, a bad signature, or an
 * expired token. `parseSessionToken` throws on all of those; this is the
 * one place that turns "throws" into "no session," which is what lets every
 * route treat "no session" as a single, uniform 401.
 *
 * This does NOT check whether the reviewer is currently active — the
 * session-tokens.ts payload docblock explains why status is deliberately
 * absent from the token. That check happens where it already happened
 * before this session existed: `loadReviewer`, called from inside the
 * queue/decision repositories, throws `ReviewerNotActiveError`, which the
 * app-level error middleware in `app.ts` maps to 401. Duplicating an
 * active-status check here would be exactly the kind of duplicate CLAUDE.md
 * warns against.
 */
export function resolveReviewerSession(req: Request): SessionTokenPayload | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  try {
    return parseSessionToken(token, sessionSecret(), new Date());
  } catch {
    return null;
  }
}

/**
 * The reviewer id carried by the current session, or null if there isn't
 * one. Routes that only need the id (every route except the
 * moderator-only escalation route) call this rather than
 * `resolveReviewerSession` directly.
 */
export function resolveReviewerId(req: Request): number | null {
  return resolveReviewerSession(req)?.reviewerId ?? null;
}

/**
 * Express middleware guarding the escalation-resolution route (session 04's
 * guard 5: only a moderator may rule on an escalated item). Responds 401
 * with no valid session, 403 with a valid session that isn't a moderator,
 * and otherwise calls `next()`.
 */
export function requireModerator(req: Request, res: Response, next: NextFunction): void {
  const session = resolveReviewerSession(req);

  if (session === null) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  if (session.role !== 'moderator') {
    res.status(403).json({ error: 'moderator role required' });
    return;
  }

  next();
}

/** A small, reusable "is this a positive integer" parser for route inputs. */
export function parsePositiveInteger(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
