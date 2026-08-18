import { Router } from 'express';
import type { IllustrationBoardService } from '@jamb/shared';
import { parsePositiveInteger, resolveReviewerId } from '../reviewer-identity';

/**
 * The illustrator queue (plan 7.12 step 5). No role gate beyond an active
 * session — illustrators are not a new `PANEL_ROLES` value, matching how
 * the brief board already treats reviewers and contributors as one pool
 * with no role-based wall.
 */
export function createIllustrationTicketsRouter(service: IllustrationBoardService): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    service.listOpenTickets().then((tickets) => res.json({ tickets })).catch(next);
  });

  router.post('/:id/claim', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const ticketId = parsePositiveInteger(req.params.id);
    if (ticketId === null) {
      res.status(400).json({ error: 'illustration ticket id must be a positive integer' });
      return;
    }

    service.claimTicket(ticketId, reviewerId).then((ticket) => res.json(ticket)).catch(next);
  });

  router.post('/:id/complete', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const ticketId = parsePositiveInteger(req.params.id);
    if (ticketId === null) {
      res.status(400).json({ error: 'illustration ticket id must be a positive integer' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body?.svgMarkup !== 'string' || body.svgMarkup.trim() === '') {
      res.status(400).json({ error: 'svgMarkup must be a non-empty string' });
      return;
    }
    if (typeof body.altText !== 'string' || body.altText.trim() === '') {
      res.status(400).json({ error: 'altText must be a non-empty string' });
      return;
    }

    service
      .completeTicket(ticketId, reviewerId, { svgMarkup: body.svgMarkup, altText: body.altText })
      .then((result) => res.json(result))
      .catch(next);
  });

  router.get('/:id/sketch-photo', (req, res, next) => {
    const reviewerId = resolveReviewerId(req);
    if (reviewerId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const ticketId = parsePositiveInteger(req.params.id);
    if (ticketId === null) {
      res.status(400).json({ error: 'illustration ticket id must be a positive integer' });
      return;
    }

    service
      .loadSketchPhoto(ticketId)
      .then((photo) => {
        if (!photo) {
          res.status(404).json({ error: 'illustration ticket not found' });
          return;
        }
        res.setHeader('Content-Type', photo.contentType);
        res.send(Buffer.from(photo.bytes));
      })
      .catch(next);
  });

  return router;
}
