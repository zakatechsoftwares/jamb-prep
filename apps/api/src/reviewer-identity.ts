import type { Request } from 'express';

/**
 * The single place `reviewerId` is derived from a request. Every
 * reviewer-facing route in `apps/api` calls this — never
 * `req.query.reviewerId` directly — so replacing the current
 * unauthenticated query parameter with a session-derived identity (build
 * log BLOCKING item B1) is a one-line change here instead of five.
 *
 * Returns null on anything that does not parse as a positive integer,
 * matching how every route already treats a missing or malformed
 * reviewerId: a 400 response, not a thrown error.
 */
export function resolveReviewerId(req: Request): number | null {
  return parsePositiveInteger(req.query.reviewerId);
}

/** A small, reusable "is this a positive integer" parser for route inputs. */
export function parsePositiveInteger(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
