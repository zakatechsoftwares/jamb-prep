import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Proves the session mechanism is actually usable end to end, not merely
// that its pieces typecheck in isolation: a real login against the real
// database, the real token it returns, used as a real Authorization header
// against a real reviewer route wired to the real @jamb/db services — no
// fakes anywhere in this file. Every other route test in apps/api injects a
// fake service and a hand-signed token; this is the one file that doesn't.
process.env.REVIEWER_SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('login end-to-end', () => {
  async function startRealApp(): Promise<{ url: string; close: () => void }> {
    const { createApp } = await import('./app');
    const db = await import('@jamb/db');

    const app = createApp({
      auth: {
        login: (emailOrPhone, password) => db.authenticateReviewer(emailOrPhone, password),
      },
      reviewQueue: {
        getNextItem: (reviewerId) => db.getNextItem(reviewerId),
        getNextItemBatch: (reviewerId, count) => db.getNextItemBatch(reviewerId, count),
      },
    });

    const server = app.listen(0);
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a bound TCP address');
    }

    return { url: `http://localhost:${address.port}`, close: () => server.close() };
  }

  async function seedReviewer(options: {
    email: string;
    password: string;
    status?: string;
  }): Promise<number> {
    const { pool, setReviewerPassword } = await import('@jamb/db');
    const client = await pool.connect();
    let reviewerId: number;
    try {
      const userId = (
        await client.query<{ id: number }>(
          `INSERT INTO users (full_name, phone, email, exam_year)
           VALUES ('E2E Reviewer', $1, $2, 2026) RETURNING id`,
          [`__e2e_${options.email}__`, options.email],
        )
      ).rows[0]!.id;

      reviewerId = (
        await client.query<{ id: number }>(
          `INSERT INTO reviewers (user_id, role, status) VALUES ($1, 'reviewer', $2) RETURNING id`,
          [userId, options.status ?? 'active'],
        )
      ).rows[0]!.id;
    } finally {
      client.release();
    }

    await setReviewerPassword(reviewerId, options.password);
    return reviewerId;
  }

  beforeEach(async () => {
    const { pool } = await import('@jamb/db');
    const client = await pool.connect();
    try {
      const { assertSafeToTruncate } = await import('@jamb/db/fixtures');
      await assertSafeToTruncate(client);
      await client.query('TRUNCATE users CASCADE');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const { pool } = await import('@jamb/db');
    const client = await pool.connect();
    try {
      const { assertSafeToTruncate } = await import('@jamb/db/fixtures');
      await assertSafeToTruncate(client);
      await client.query('TRUNCATE users CASCADE');
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('logs in with seeded credentials and uses the returned token against a real reviewer route', async () => {
    await seedReviewer({
      email: 'e2e-reviewer@example.test',
      password: 'correct horse battery staple',
    });

    const { url, close } = await startRealApp();
    try {
      const loginResponse = await fetch(`${url}/review/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrPhone: 'e2e-reviewer@example.test',
          password: 'correct horse battery staple',
        }),
      });
      expect(loginResponse.status).toBe(200);

      const { token } = (await loginResponse.json()) as { token: string };
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      // A request with no token first, to prove the route is genuinely
      // gated — otherwise a 204 below would prove nothing about the token
      // mattering at all.
      const withoutToken = await fetch(`${url}/review/next`);
      expect(withoutToken.status).toBe(401);

      // Then the real token against the real route. This reviewer has no
      // subjects assigned, so the queue has nothing to serve — 204, not an
      // error — which is exactly the "cleared authentication, reached the
      // real service" signal: an unauthenticated request gets 401, never
      // 204.
      const withToken = await fetch(`${url}/review/next`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(withToken.status).toBe(204);
    } finally {
      close();
    }
  });

  it('never issues a token for a wrong password against a real, seeded reviewer', async () => {
    await seedReviewer({ email: 'e2e-wrong-password@example.test', password: 'the-real-password' });

    const { url, close } = await startRealApp();
    try {
      const response = await fetch(`${url}/review/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrPhone: 'e2e-wrong-password@example.test',
          password: 'a-guess',
        }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'invalid_credentials' });
    } finally {
      close();
    }
  });

  it('never issues a token for a suspended reviewer, even with the correct password', async () => {
    await seedReviewer({
      email: 'e2e-suspended@example.test',
      password: 'still-the-real-password',
      status: 'suspended',
    });

    const { url, close } = await startRealApp();
    try {
      const response = await fetch(`${url}/review/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrPhone: 'e2e-suspended@example.test',
          password: 'still-the-real-password',
        }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).not.toHaveProperty('token');
    } finally {
      close();
    }
  });
});
