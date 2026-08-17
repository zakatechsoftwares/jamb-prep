import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// authenticateReviewer and setReviewerPassword each open their own
// connection (like goldStockoutsSince), rather than sharing a transaction
// with the caller — a login is its own atomic unit, never part of a larger
// one. That means fixtures here must be genuinely committed, not just
// held in an uncommitted transaction on a separate client, so this file
// follows review-queue.fixtures.ts's commit-then-TRUNCATE pattern rather
// than the roll-back-a-transaction pattern the append-only guard tests use.
const hasDatabase = Boolean(process.env.DATABASE_URL);

interface Fixture {
  reviewerId: number;
  userId: number;
}

async function insertReviewer(
  client: import('pg').PoolClient,
  options: { phone: string; email?: string; status?: string; role?: string },
): Promise<Fixture> {
  const { firstRow } = await import('./first-row');

  const userId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO users (full_name, phone, email, exam_year)
       VALUES ('Auth Test', $1, $2, 2026) RETURNING id`,
      [options.phone, options.email ?? null],
    ),
  ).id;

  const reviewerId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO reviewers (user_id, role, status) VALUES ($1, $2, $3) RETURNING id`,
      [userId, options.role ?? 'reviewer', options.status ?? 'active'],
    ),
  ).id;

  return { reviewerId, userId };
}

describe.runIf(hasDatabase)('reviewer auth', () => {
  beforeEach(async () => {
    const { pool } = await import('./client');
    const client = await pool.connect();
    try {
      const { assertSafeToTruncate } = await import('./review-queue.fixtures');
      await assertSafeToTruncate(client);
      await client.query('TRUNCATE users CASCADE');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const { pool } = await import('./client');
    const client = await pool.connect();
    try {
      const { assertSafeToTruncate } = await import('./review-queue.fixtures');
      await assertSafeToTruncate(client);
      await client.query('TRUNCATE users CASCADE');
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('authenticates by email with the correct password', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const fixture = await insertReviewer(client, {
        phone: '__auth_email_phone__',
        email: 'reviewer@example.test',
        role: 'moderator',
      });
      await auth.setReviewerPassword(fixture.reviewerId, 'correct horse battery staple');

      const result = await auth.authenticateReviewer(
        'reviewer@example.test',
        'correct horse battery staple',
      );

      expect(result).toEqual({
        ok: true,
        reviewerId: fixture.reviewerId,
        userId: fixture.userId,
        role: 'moderator',
      });
    } finally {
      client.release();
    }
  });

  it('authenticates by phone with the correct password', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const fixture = await insertReviewer(client, { phone: '__auth_phone_only__' });
      await auth.setReviewerPassword(fixture.reviewerId, 'a-different-password');

      const result = await auth.authenticateReviewer('__auth_phone_only__', 'a-different-password');

      expect(result).toMatchObject({ ok: true, reviewerId: fixture.reviewerId });
    } finally {
      client.release();
    }
  });

  it('rejects a wrong password with invalid_credentials', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      await insertReviewer(client, { phone: '__auth_wrong_password__' });
      await auth.setReviewerPassword(
        (await insertReviewer(client, { phone: '__auth_wrong_password_2__' })).reviewerId,
        'the-real-password',
      );

      const result = await auth.authenticateReviewer('__auth_wrong_password_2__', 'a-guess');

      expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    } finally {
      client.release();
    }
  });

  it('rejects an identifier that matches no user with invalid_credentials', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const result = await auth.authenticateReviewer('nobody@example.test', 'anything');

      expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    } finally {
      client.release();
    }
  });

  it('rejects a reviewer with no password_hash set, rather than accepting any password or crashing', async () => {
    // The specific case addition 2 calls out: password_hash is nullable —
    // a reviewer can exist before ever being given a credential — and a
    // NULL there must behave exactly like a wrong password, never like an
    // open door and never like an unhandled scrypt comparison failure.
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const fixture = await insertReviewer(client, { phone: '__auth_no_password__' });
      const stored = await client.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM reviewers WHERE id = $1`,
        [fixture.reviewerId],
      );
      expect(stored.rows[0]?.password_hash).toBeNull();

      const result = await auth.authenticateReviewer('__auth_no_password__', 'anything-at-all');

      expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    } finally {
      client.release();
    }
  });

  it('rejects a suspended reviewer with the correct password, distinctly from a bad credential', async () => {
    // Reuses loadReviewer's activation check (7.8) rather than
    // re-implementing it, and only after the password has already
    // verified — the caller already holds valid credentials at this
    // point, so naming the reason is not an information leak.
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const fixture = await insertReviewer(client, {
        phone: '__auth_suspended__',
        status: 'suspended',
      });
      await auth.setReviewerPassword(fixture.reviewerId, 'still-the-real-password');

      const result = await auth.authenticateReviewer(
        '__auth_suspended__',
        'still-the-real-password',
      );

      expect(result).toEqual({ ok: false, reason: 'not_active', status: 'suspended' });
    } finally {
      client.release();
    }
  });

  it('rejects a reviewer who applied but was never activated', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const fixture = await insertReviewer(client, {
        phone: '__auth_applied__',
        status: 'applied',
      });
      await auth.setReviewerPassword(fixture.reviewerId, 'a-password');

      const result = await auth.authenticateReviewer('__auth_applied__', 'a-password');

      expect(result).toEqual({ ok: false, reason: 'not_active', status: 'applied' });
    } finally {
      client.release();
    }
  });

  it('authenticates with only the most recently provisioned password', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const fixture = await insertReviewer(client, { phone: '__auth_reprovision__' });
      await auth.setReviewerPassword(fixture.reviewerId, 'first-password');
      await auth.setReviewerPassword(fixture.reviewerId, 'second-password');

      const withOld = await auth.authenticateReviewer('__auth_reprovision__', 'first-password');
      const withNew = await auth.authenticateReviewer('__auth_reprovision__', 'second-password');

      expect(withOld).toEqual({ ok: false, reason: 'invalid_credentials' });
      expect(withNew).toMatchObject({ ok: true, reviewerId: fixture.reviewerId });
    } finally {
      client.release();
    }
  });

  it('never authenticates one reviewer’s identifier against another reviewer’s password', async () => {
    const { pool } = await import('./client');
    const auth = await import('./reviewer-auth-repository');
    const client = await pool.connect();

    try {
      const a = await insertReviewer(client, { phone: '__auth_reviewer_a__' });
      const b = await insertReviewer(client, { phone: '__auth_reviewer_b__' });
      await auth.setReviewerPassword(a.reviewerId, 'password-for-a');
      await auth.setReviewerPassword(b.reviewerId, 'password-for-b');

      const result = await auth.authenticateReviewer('__auth_reviewer_a__', 'password-for-b');

      expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    } finally {
      client.release();
    }
  });
});
