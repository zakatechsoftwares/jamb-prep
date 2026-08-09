import { Router } from 'express';
import type { ContentLeadService } from '@jamb/shared';
import { parsePositiveInteger, requireContentLead, requireModerator, resolveReviewerId } from '../reviewer-identity';

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw === '') {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The content-lead dashboard, the weekly payment run, and the moderator's
 * audit sample/recording (plan 7.11). Mounted at `/content-lead` as one
 * router because they're one feature area — but gated by two different
 * roles: the dashboard and payment run are the content lead's own view and
 * action, while the audit routes are the moderator's (re-)review of a
 * sampled reviewer's approvals, so `moderatorId` is always taken from the
 * authenticated session, never from the request body — the same reasoning
 * that keeps `reviewerId` off the wire in every other decision route here.
 */
export function createContentLeadRouter(service: ContentLeadService): Router {
  const router = Router();

  router.get('/dashboard', requireContentLead, (req, res, next) => {
    const since = parseDate(req.query.since);
    if (since === null) {
      res.status(400).json({ error: 'since must be a valid ISO 8601 date query parameter' });
      return;
    }

    service.getDashboard(since).then((dashboard) => res.json(dashboard)).catch(next);
  });

  router.post('/payment-runs', requireContentLead, (req, res, next) => {
    const body = req.body as Record<string, unknown> | undefined;
    const runAt = body?.runAt === undefined ? new Date() : parseDate(body.runAt);
    if (runAt === null) {
      res.status(400).json({ error: 'runAt must be a valid ISO 8601 date' });
      return;
    }

    service.runWeeklyPayment(runAt).then((result) => res.json(result)).catch(next);
  });

  router.get('/audit-sample', requireModerator, (req, res, next) => {
    const reviewerId = parsePositiveInteger(req.query.reviewerId);
    const since = parseDate(req.query.since);
    const count = parsePositiveInteger(req.query.count);

    if (reviewerId === null) {
      res.status(400).json({ error: 'reviewerId must be a positive integer query parameter' });
      return;
    }
    if (since === null) {
      res.status(400).json({ error: 'since must be a valid ISO 8601 date query parameter' });
      return;
    }
    if (count === null) {
      res.status(400).json({ error: 'count must be a positive integer query parameter' });
      return;
    }

    service.getAuditSample(reviewerId, since, count).then((sample) => res.json(sample)).catch(next);
  });

  router.post('/audits/:itemId', requireModerator, (req, res, next) => {
    const moderatorId = resolveReviewerId(req);
    if (moderatorId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const itemId = parsePositiveInteger(req.params.itemId);
    const body = req.body as Record<string, unknown> | undefined;
    const agreed = body?.agreed;
    const note = body?.note;

    if (itemId === null) {
      res.status(400).json({ error: 'itemId must be a positive integer' });
      return;
    }
    if (typeof agreed !== 'boolean') {
      res.status(400).json({ error: 'agreed must be a boolean' });
      return;
    }
    if (note !== undefined && note !== null && typeof note !== 'string') {
      res.status(400).json({ error: 'note must be a string or null' });
      return;
    }

    service
      .recordModeratorAudit(itemId, moderatorId, agreed, note ?? null)
      .then(() => res.status(204).end())
      .catch(next);
  });

  return router;
}
