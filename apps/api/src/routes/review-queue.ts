import { Router } from 'express';
import type { ReviewQueueItem, ReviewQueueService } from '@jamb/shared';

/**
 * The reviewer workspace's queue endpoints (plan 7.9).
 *
 * There is deliberately no list endpoint, no filter and no search. The
 * reviewer never chooses what to work on — the system assigns one item —
 * which is what prevents cherry-picking of easy items. Adding a "browse the
 * queue" route later would quietly undo that.
 *
 * The service is injected rather than imported, so this module never pulls
 * in a database connection at load time.
 */
export function createReviewQueueRouter(service: ReviewQueueService): Router {
  const router = Router();

  router.get('/next', (req, res, next) => {
    const reviewerId = parseReviewerId(req.query.reviewerId);

    if (reviewerId === null) {
      res.status(400).json({ error: 'reviewerId must be a positive integer' });
      return;
    }

    service
      .getNextItem(reviewerId)
      .then((item) => {
        if (!item) {
          // Nothing available is an ordinary state for a reviewer whose
          // subjects are drained, not an error.
          res.status(204).end();
          return;
        }

        res.json(serialiseItem(item));
      })
      .catch(next);
  });

  router.get('/next-batch', (req, res, next) => {
    const reviewerId = parseReviewerId(req.query.reviewerId);
    const count = parseCount(req.query.count);

    if (reviewerId === null) {
      res.status(400).json({ error: 'reviewerId must be a positive integer' });
      return;
    }

    if (count === null) {
      res.status(400).json({ error: 'count must be a positive integer' });
      return;
    }

    service
      .getNextItemBatch(reviewerId, count)
      .then((items) => {
        res.json({ items: items.map(serialiseItem) });
      })
      .catch(next);
  });

  return router;
}

function parseReviewerId(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseCount(raw: unknown): number | null {
  if (raw === undefined) {
    return null;
  }

  return parseReviewerId(raw);
}

/**
 * Dates over the wire as ISO strings. Everything else passes through
 * unchanged — in particular nothing is added here, so a gold item and an
 * ordinary one serialise identically.
 */
function serialiseItem(item: ReviewQueueItem): Record<string, unknown> {
  return { ...item, claimExpiresAt: item.claimExpiresAt.toISOString() };
}
