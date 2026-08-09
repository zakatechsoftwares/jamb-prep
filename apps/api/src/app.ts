import express, { type Express } from 'express';
import type {
  HealthStatus,
  ReviewDecisionService,
  ReviewEscalationService,
  ReviewQueueService,
} from '@jamb/shared';
// From the dependency-free `./reviewer-errors` subpath, not `@jamb/db`'s
// index — importing the index here would open a connection pool at module
// load (see the comment on `AppDependencies` below), exactly what injecting
// the services instead of importing them is meant to avoid.
import { ReviewerNotActiveError } from '@jamb/db/reviewer-errors';
import { createReviewDecisionRouter } from './routes/review-decision';
import { createReviewEscalationRouter } from './routes/review-escalation';
import { createReviewQueueRouter } from './routes/review-queue';

export interface AppDependencies {
  /**
   * Injected rather than imported: `@jamb/db` opens a connection pool at
   * module load, and createApp must stay callable in a test with no
   * database.
   */
  reviewQueue?: ReviewQueueService;
  reviewDecision?: ReviewDecisionService;
  reviewEscalation?: ReviewEscalationService;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const status: HealthStatus = 'ok';
    res.json({ status, service: 'api' });
  });

  if (dependencies.reviewQueue) {
    app.use('/review', createReviewQueueRouter(dependencies.reviewQueue));
  }
  if (dependencies.reviewDecision) {
    app.use('/review', createReviewDecisionRouter(dependencies.reviewDecision));
  }
  if (dependencies.reviewEscalation) {
    app.use('/review', createReviewEscalationRouter(dependencies.reviewEscalation));
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
      next(error);
    },
  );

  return app;
}
