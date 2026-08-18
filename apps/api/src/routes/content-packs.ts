import { Router } from 'express';
import type { ContentPackService } from '@jamb/shared';
import { resolveCandidateId } from '../candidate-identity';
import { parsePositiveInteger } from '../reviewer-identity';

/**
 * Content sync (plan 8.3, follow-up to progress sync): subject-pack
 * delivery. Mounted at `/candidate` alongside `routes/candidate.ts` --
 * candidate-auth-gated like every other candidate route, even though
 * nothing here is entitlement-gated yet, so a future entitlement check
 * slots in without changing this route's shape.
 */
export function createContentPacksRouter(service: ContentPackService): Router {
  const router = Router();

  router.get('/content-packs', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    service.listAvailablePacks().then((manifest) => res.json(manifest)).catch(next);
  });

  router.get('/content-packs/:subjectId', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const subjectId = parsePositiveInteger(req.params.subjectId);
    if (subjectId === null) {
      res.status(400).json({ error: 'subject id must be a positive integer' });
      return;
    }

    service
      .downloadPack(subjectId)
      .then((pack) => {
        if (!pack) {
          res.status(404).json({ error: 'no pack available for this subject' });
          return;
        }
        res.json(pack);
      })
      .catch(next);
  });

  return router;
}
