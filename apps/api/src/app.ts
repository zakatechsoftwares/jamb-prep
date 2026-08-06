import express, { type Express } from 'express';
import type { HealthStatus } from '@jamb/shared';

export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    const status: HealthStatus = 'ok';
    res.json({ status, service: 'api' });
  });

  return app;
}
