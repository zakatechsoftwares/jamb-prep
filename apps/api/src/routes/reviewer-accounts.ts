import { Router, type Response } from 'express';
import {
  parseCreateReviewerAccountInput,
  parseReviewerStatusInput,
  type ReviewerAccountService,
} from '@jamb/shared';
import { parsePositiveInteger, requireContentLead } from '../reviewer-identity';

const REFUSAL_STATUS = { not_found: 404, not_manageable: 403 } as const;

/**
 * A response carrying a temporary password must never be cached by the
 * browser, the Next.js proxy in front of this API, or anything between.
 */
function noStore(res: Response): Response {
  return res.set('Cache-Control', 'no-store');
}

function badRequest(res: Response, error: unknown): void {
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

/**
 * Content-lead management of panel accounts (plan 7.8). Mounted at
 * `/content-lead` next to the dashboard router, and gated the same way —
 * every route here is the content lead's alone.
 */
export function createReviewerAccountsRouter(service: ReviewerAccountService): Router {
  const router = Router();

  router.get('/reviewers', requireContentLead, (_req, res, next) => {
    service
      .listAccounts()
      .then((accounts) => res.json({ accounts }))
      .catch(next);
  });

  router.get('/subjects', requireContentLead, (_req, res, next) => {
    service
      .listSubjects()
      .then((subjects) => res.json({ subjects }))
      .catch(next);
  });

  router.post('/reviewers', requireContentLead, (req, res, next) => {
    let input;
    try {
      input = parseCreateReviewerAccountInput(req.body);
    } catch (error) {
      badRequest(res, error);
      return;
    }

    service
      .createAccount(input)
      .then((outcome) => {
        if (outcome.ok) {
          noStore(res)
            .status(201)
            .json({ reviewerId: outcome.reviewerId, temporaryPassword: outcome.temporaryPassword });
          return;
        }
        res.status(outcome.reason === 'unknown_subject' ? 400 : 409).json({ error: outcome.reason });
      })
      .catch(next);
  });

  router.post('/reviewers/:reviewerId/reset-password', requireContentLead, (req, res, next) => {
    const reviewerId = parsePositiveInteger(req.params.reviewerId);
    if (reviewerId === null) {
      res.status(400).json({ error: 'reviewerId must be a positive integer' });
      return;
    }

    service
      .resetPassword(reviewerId)
      .then((outcome) => {
        if (outcome.ok) {
          noStore(res).json({ temporaryPassword: outcome.temporaryPassword });
          return;
        }
        res.status(REFUSAL_STATUS[outcome.reason]).json({ error: outcome.reason });
      })
      .catch(next);
  });

  router.post('/reviewers/:reviewerId/status', requireContentLead, (req, res, next) => {
    const reviewerId = parsePositiveInteger(req.params.reviewerId);
    if (reviewerId === null) {
      res.status(400).json({ error: 'reviewerId must be a positive integer' });
      return;
    }

    let status;
    try {
      ({ status } = parseReviewerStatusInput(req.body));
    } catch (error) {
      badRequest(res, error);
      return;
    }

    service
      .setStatus(reviewerId, status)
      .then((outcome) => {
        if (outcome.ok) {
          res.status(204).end();
          return;
        }
        res.status(REFUSAL_STATUS[outcome.reason]).json({ error: outcome.reason });
      })
      .catch(next);
  });

  return router;
}
