import { Router } from 'express';
import { parseResolveEscalationInput, type ReviewEscalationService } from '@jamb/shared';
import { parsePositiveInteger, requireModerator, resolveReviewerId } from '../reviewer-identity';

/**
 * The escalation-resolution route (session 04's guard 5: only a moderator
 * resolves an item in `escalated`). Deliberately its own router rather than
 * folded into `createReviewDecisionRouter` — `requireModerator` gates this
 * one route and no other, and resolving an escalation carries no claim to
 * check, unlike every action `decide` handles.
 */
export function createReviewEscalationRouter(service: ReviewEscalationService): Router {
  const router = Router();

  router.post('/:itemId/resolve-escalation', requireModerator, (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    const itemId = parsePositiveInteger(req.params.itemId);

    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (itemId === null) {
      res.status(400).json({ error: 'itemId must be a positive integer' });
      return;
    }

    let input;
    try {
      input = parseResolveEscalationInput(req.body);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    service
      .resolveEscalation(reviewerId, itemId, input)
      .then((outcome) => {
        if (!outcome.ok) {
          res.status(409).json({ error: outcome.reason, message: outcome.message });
          return;
        }

        res.json({
          itemId: outcome.itemId,
          status: outcome.status,
          approvalRoute: outcome.approvalRoute,
        });
      })
      .catch(next);
  });

  return router;
}
