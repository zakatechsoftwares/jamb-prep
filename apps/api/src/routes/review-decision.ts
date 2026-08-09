import { Router } from 'express';
import { parseDecisionInput, parseOptionLabel, type ReviewDecisionService } from '@jamb/shared';
import { parsePositiveInteger, resolveReviewerId } from '../reviewer-identity';

/**
 * The decision endpoints (plan 7.10): submitting a blind answer, revealing
 * the proposed key, and recording one of the four review actions.
 *
 * The anti-anchoring control is enforced here, not merely documented: a
 * high risk_tier item's key, explanation and verdict are absent from every
 * response until `revealItem` reports `ok: true`. There is no code path in
 * this router — or in `getNextItem`'s payload, which never carried them in
 * the first place — that can put the key in a response ahead of that.
 */
export function createReviewDecisionRouter(service: ReviewDecisionService): Router {
  const router = Router();

  router.post('/:itemId/solve', (req, res, next) => {
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

    let answer;
    try {
      answer = parseOptionLabel(
        (req.body as Record<string, unknown> | undefined)?.answer,
        'answer',
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    service
      .submitBlindAnswer(reviewerId, itemId, answer)
      .then((outcome) => {
        if (!outcome.ok) {
          res.status(outcome.reason === 'already_answered' ? 409 : 403).json({
            error: outcome.reason,
          });
          return;
        }

        res.json({ itemId: outcome.itemId, answer: outcome.answer });
      })
      .catch(next);
  });

  router.get('/:itemId/reveal', (req, res, next) => {
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

    service
      .revealItem(reviewerId, itemId)
      .then((outcome) => {
        if (!outcome.ok) {
          // Both failure reasons are 403: "not yours" and "not yet solved"
          // are both "you may not see this yet", and the anti-anchoring
          // control gains nothing from telling a caller which one applies
          // instead of just declining.
          res.status(403).json({ error: outcome.reason });
          return;
        }

        res.json({
          correctOption: outcome.correctOption,
          explanation: outcome.explanation,
          verdict: outcome.verdict,
          agreesWithKey: outcome.agreesWithKey,
        });
      })
      .catch(next);
  });

  router.post('/:itemId/decide', (req, res, next) => {
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

    let parsed;
    try {
      parsed = parseDecisionInput(req.body);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const idempotencyKey = (req.body as Record<string, unknown>).idempotencyKey;
    if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
      res.status(400).json({ error: 'idempotencyKey must be a string' });
      return;
    }

    service
      .decideOnItem(reviewerId, itemId, { ...parsed, idempotencyKey })
      .then((outcome) => {
        if (!outcome.ok) {
          res.status(outcome.reason === 'not_claimed_by_you' ? 403 : 409).json({
            error: outcome.reason,
            ...('message' in outcome ? { message: outcome.message } : {}),
          });
          return;
        }

        res.json({
          itemId: outcome.itemId,
          status: outcome.status,
          approvalRoute: outcome.approvalRoute,
          decisionContext: outcome.decisionContext,
        });
      })
      .catch(next);
  });

  return router;
}
