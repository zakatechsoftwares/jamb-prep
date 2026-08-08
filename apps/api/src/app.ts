import express, { type Express } from 'express';
import type { HealthStatus, ReviewQueueService } from '@jamb/shared';
import { createReviewQueueRouter } from './routes/review-queue';

export interface AppDependencies {
  /**
   * Injected rather than imported: `@jamb/db` opens a connection pool at
   * module load, and createApp must stay callable in a test with no
   * database.
   */
  reviewQueue?: ReviewQueueService;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    const status: HealthStatus = 'ok';
    res.json({ status, service: 'api' });
  });

  if (dependencies.reviewQueue) {
    app.use('/review', createReviewQueueRouter(dependencies.reviewQueue));
  }

  return app;
}
