import express, { type Express } from 'express';
import { MulterError } from 'multer';
import type {
  AuthService,
  BriefBoardService,
  CandidateSyncService,
  ContentLeadService,
  ContentPackService,
  HealthStatus,
  IllustrationBoardService,
  ReviewDecisionService,
  ReviewEscalationService,
  ReviewQueueService,
  SubjectCombinationService,
} from '@jamb/shared';
// From the dependency-free `./reviewer-errors` subpath, not `@jamb/db`'s
// index — importing the index here would open a connection pool at module
// load (see the comment on `AppDependencies` below), exactly what injecting
// the services instead of importing them is meant to avoid.
import { ReviewerNotActiveError } from '@jamb/db/reviewer-errors';
import { createAuthRouter } from './routes/auth';
import { createBriefsRouter } from './routes/briefs';
import { createCandidateRouter } from './routes/candidate';
import { createContentLeadRouter } from './routes/content-lead';
import { createContentPacksRouter } from './routes/content-packs';
import { createIllustrationTicketsRouter } from './routes/illustration-tickets';
import { createReviewDecisionRouter } from './routes/review-decision';
import { createReviewEscalationRouter } from './routes/review-escalation';
import { createReviewQueueRouter } from './routes/review-queue';
import { createSubjectCombinationsRouter } from './routes/subject-combinations';

export interface AppDependencies {
  /**
   * Injected rather than imported: `@jamb/db` opens a connection pool at
   * module load, and createApp must stay callable in a test with no
   * database.
   */
  reviewQueue?: ReviewQueueService;
  reviewDecision?: ReviewDecisionService;
  reviewEscalation?: ReviewEscalationService;
  auth?: AuthService;
  contentLead?: ContentLeadService;
  briefBoard?: BriefBoardService;
  illustrationBoard?: IllustrationBoardService;
  candidateSync?: CandidateSyncService;
  contentPack?: ContentPackService;
  subjectCombination?: SubjectCombinationService;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const status: HealthStatus = 'ok';
    res.json({ status, service: 'api' });
  });

  if (dependencies.auth) {
    app.use('/review', createAuthRouter(dependencies.auth));
  }
  if (dependencies.reviewQueue) {
    app.use('/review', createReviewQueueRouter(dependencies.reviewQueue));
  }
  if (dependencies.reviewDecision) {
    app.use('/review', createReviewDecisionRouter(dependencies.reviewDecision));
  }
  if (dependencies.reviewEscalation) {
    app.use('/review', createReviewEscalationRouter(dependencies.reviewEscalation));
  }
  if (dependencies.contentLead) {
    app.use('/content-lead', createContentLeadRouter(dependencies.contentLead));
  }
  if (dependencies.briefBoard) {
    app.use('/briefs', createBriefsRouter(dependencies.briefBoard));
  }
  if (dependencies.illustrationBoard) {
    app.use('/illustration-tickets', createIllustrationTicketsRouter(dependencies.illustrationBoard));
  }
  if (dependencies.candidateSync) {
    app.use('/candidate', createCandidateRouter(dependencies.candidateSync));
  }
  if (dependencies.contentPack) {
    app.use('/candidate', createContentPacksRouter(dependencies.contentPack));
  }
  if (dependencies.subjectCombination) {
    app.use('/candidate', createSubjectCombinationsRouter(dependencies.subjectCombination));
  }

  // The one place `ReviewerNotActiveError` becomes a 401. Every reviewer
  // route's handler forwards a repository error to `next` unchanged; this
  // is what lets loadReviewer's activation check (7.8), reused rather than
  // duplicated across every route, turn into the same response everywhere
  // it's thrown from.
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (error instanceof ReviewerNotActiveError) {
        res.status(401).json({ error: 'reviewer is not active' });
        return;
      }
      // multer rejects an oversized sketch photo (routes/briefs.ts's
      // `/submit-with-diagram`) by throwing rather than by a normal
      // service-layer error, so it needs the same one-place treatment.
      if (error instanceof MulterError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    },
  );

  return app;
}
