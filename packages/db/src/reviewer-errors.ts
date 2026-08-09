/**
 * Thrown by `loadReviewer` when the reviewer exists but is not `active`
 * (7.8). A distinguishable class rather than a bare `Error`, so a caller —
 * the API layer's session auth, in particular — can map exactly this
 * failure to a specific response (401) without pattern-matching an error
 * message. Reusing `loadReviewer` from every place a reviewer's identity
 * needs to be trusted is what keeps the activation check in one place;
 * this class is what lets a caller act on it precisely.
 *
 * Deliberately its own module with no dependency on `./client` (and so no
 * connection pool opened at import time): `apps/api`'s error middleware
 * needs a real `instanceof` check against this class without pulling in
 * `@jamb/db`'s index, which does open a pool at module load.
 */
export class ReviewerNotActiveError extends Error {
  constructor(
    public readonly reviewerId: number,
    public readonly status: string,
  ) {
    super(
      `reviewer ${reviewerId} is '${status}', not active — only an activated reviewer is trusted (7.8)`,
    );
    this.name = 'ReviewerNotActiveError';
  }
}
