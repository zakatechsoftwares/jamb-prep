import { Router } from 'express';
import type { SubjectCombinationService } from '@jamb/shared';
import { resolveCandidateId } from '../candidate-identity';

/**
 * Subject-combination onboarding, mounted at `/candidate` alongside every
 * other candidate route — any active session, not entitlement-gated,
 * matching `content-packs.ts`'s own gating.
 */
export function createSubjectCombinationsRouter(service: SubjectCombinationService): Router {
  const router = Router();

  router.get('/subject-combinations', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    service.listSubjectCombinations().then((combinations) => res.json({ combinations })).catch(next);
  });

  router.post('/subject-combination', (req, res, next) => {
    const candidateUserId = resolveCandidateId(req);
    if (candidateUserId === null) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!Number.isInteger(body?.subjectCombinationId) || (body!.subjectCombinationId as number) <= 0) {
      res.status(400).json({ error: 'subjectCombinationId must be a positive integer' });
      return;
    }

    service
      .selectSubjectCombination(candidateUserId, { subjectCombinationId: body!.subjectCombinationId as number })
      .then(() => res.json({ ok: true }))
      .catch(next);
  });

  return router;
}
