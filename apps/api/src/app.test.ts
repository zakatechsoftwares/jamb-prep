import { describe, expect, it, afterAll } from 'vitest';
import { createApp } from './app';

describe('GET /health', () => {
  const app = createApp();
  const server = app.listen(0);

  afterAll(() => {
    server.close();
  });

  it('returns ok status', async () => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a bound TCP address');
    }

    const response = await fetch(`http://localhost:${address.port}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok', service: 'api' });
  });
});
