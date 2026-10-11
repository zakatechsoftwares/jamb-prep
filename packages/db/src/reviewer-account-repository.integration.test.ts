import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateReviewerAccountInput } from '@jamb/shared';

// Every function under test opens its own connection or transaction, so the
// fixtures must be genuinely committed — the same commit-then-TRUNCATE
// pattern as reviewer-auth-repository.integration.test.ts.
const hasDatabase = Boolean(process.env.DATABASE_URL);

const CREATED_AT = new Date('2026-10-11T09:00:00.000Z');

async function withClient<T>(run: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const { pool } = await import('./client');
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

async function truncate(): Promise<void> {
  await withClient(async (client) => {
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    await truncateQueueWorld(client);
  });
}

async function insertSubject(name: string): Promise<number> {
  const { firstRow } = await import('./first-row');
  return withClient(
    async (client) =>
      firstRow(
        await client.query<{ id: number }>(`INSERT INTO subjects (name) VALUES ($1) RETURNING id`, [
          name,
        ]),
      ).id,
  );
}

function input(overrides: Partial<CreateReviewerAccountInput> = {}): CreateReviewerAccountInput {
  return {
    fullName: 'Adaeze Okafor',
    phone: '+2348031234567',
    email: 'adaeze@example.test',
    role: 'reviewer',
    subjectIds: [],
    ...overrides,
  };
}

describe.runIf(hasDatabase)('reviewer account management', () => {
  beforeEach(truncate);

  afterAll(async () => {
    await truncate();
    const { pool } = await import('./client');
    await pool.end();
  });

  it('creates users, reviewers and reviewer_subjects rows with every column written', async () => {
    const accounts = await import('./reviewer-account-repository');
    const physics = await insertSubject('Physics');
    const biology = await insertSubject('Biology');

    const outcome = await accounts.createReviewerAccount(
      input({ subjectIds: [physics, biology] }),
      CREATED_AT,
      () => 'TempPass2345',
    );
    expect(outcome).toEqual({ ok: true, reviewerId: expect.any(Number), temporaryPassword: 'TempPass2345' });
    if (!outcome.ok) throw new Error('unreachable');

    const row = await withClient(async (client) => {
      const { firstRow } = await import('./first-row');
      return firstRow(
        await client.query<{
          full_name: string;
          phone: string;
          email: string;
          exam_year: number;
          role: string;
          status: string;
          activated_at: Date;
          password_hash: string;
          must_change_password: boolean;
        }>(
          `SELECT u.full_name, u.phone, u.email, u.exam_year,
                  r.role, r.status, r.activated_at, r.password_hash, r.must_change_password
             FROM reviewers r JOIN users u ON u.id = r.user_id
            WHERE r.id = $1`,
          [outcome.reviewerId],
        ),
      );
    });

    expect(row).toMatchObject({
      full_name: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze@example.test',
      exam_year: 2026,
      role: 'reviewer',
      status: 'active',
      must_change_password: true,
    });
    expect(row.activated_at.toISOString()).toBe(CREATED_AT.toISOString());
    // Hashed, never stored in plain text.
    expect(row.password_hash).not.toContain('TempPass2345');
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);

    const subjectIds = await withClient(async (client) =>
      (
        await client.query<{ subject_id: number }>(
          `SELECT subject_id FROM reviewer_subjects WHERE reviewer_id = $1 ORDER BY subject_id`,
          [outcome.reviewerId],
        )
      ).rows.map((r) => r.subject_id),
    );
    expect(subjectIds).toEqual([physics, biology].sort((a, b) => a - b));
  });

  it('lets the new account log in with the temporary password, flagged for a change', async () => {
    const accounts = await import('./reviewer-account-repository');
    const auth = await import('./reviewer-auth-repository');
    const outcome = await accounts.createReviewerAccount(input(), CREATED_AT, () => 'TempPass2345');
    if (!outcome.ok) throw new Error('unreachable');

    expect(await auth.authenticateReviewer('adaeze@example.test', 'TempPass2345')).toEqual({
      ok: true,
      reviewerId: outcome.reviewerId,
      userId: expect.any(Number),
      role: 'reviewer',
      mustChangePassword: true,
    });
  });

  it('clears the flag when the reviewer changes their own password', async () => {
    const accounts = await import('./reviewer-account-repository');
    const auth = await import('./reviewer-auth-repository');
    const outcome = await accounts.createReviewerAccount(input(), CREATED_AT, () => 'TempPass2345');
    if (!outcome.ok) throw new Error('unreachable');

    expect(await auth.changeOwnPassword(outcome.reviewerId, 'TempPass2345', 'my-own-secret')).toEqual(
      { ok: true },
    );

    expect(await auth.authenticateReviewer('adaeze@example.test', 'TempPass2345')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect(await auth.authenticateReviewer('+2348031234567', 'my-own-secret')).toMatchObject({
      ok: true,
      mustChangePassword: false,
    });
  });

  it('refuses a password change with the wrong current password, leaving everything as it was', async () => {
    const accounts = await import('./reviewer-account-repository');
    const auth = await import('./reviewer-auth-repository');
    const outcome = await accounts.createReviewerAccount(input(), CREATED_AT, () => 'TempPass2345');
    if (!outcome.ok) throw new Error('unreachable');

    expect(await auth.changeOwnPassword(outcome.reviewerId, 'not-it', 'my-own-secret')).toEqual({
      ok: false,
      reason: 'wrong_current_password',
    });
    expect(await auth.authenticateReviewer('adaeze@example.test', 'TempPass2345')).toMatchObject({
      ok: true,
      mustChangePassword: true,
    });
  });

  it('refuses a password change for a suspended reviewer', async () => {
    const accounts = await import('./reviewer-account-repository');
    const auth = await import('./reviewer-auth-repository');
    const { ReviewerNotActiveError } = await import('./review-queue-repository');
    const outcome = await accounts.createReviewerAccount(input(), CREATED_AT, () => 'TempPass2345');
    if (!outcome.ok) throw new Error('unreachable');
    await accounts.setReviewerStatus(outcome.reviewerId, 'suspended');

    await expect(
      auth.changeOwnPassword(outcome.reviewerId, 'TempPass2345', 'my-own-secret'),
    ).rejects.toBeInstanceOf(ReviewerNotActiveError);
  });

  it('rejects a phone that already belongs to any user — a candidate included — and writes nothing', async () => {
    const accounts = await import('./reviewer-account-repository');
    await withClient((client) =>
      client.query(
        `INSERT INTO users (full_name, phone, exam_year) VALUES ('A Candidate', '+2348031234567', 2027)`,
      ),
    );

    expect(
      await accounts.createReviewerAccount(input({ email: 'other@example.test' }), CREATED_AT),
    ).toEqual({ ok: false, reason: 'phone_taken' });

    const counts = await withClient(async (client) => {
      const { firstRow } = await import('./first-row');
      return firstRow(
        await client.query<{ users: number; reviewers: number }>(
          `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM reviewers)::int AS reviewers`,
        ),
      );
    });
    expect(counts).toEqual({ users: 1, reviewers: 0 });
  });

  it('rejects an email that already belongs to another user', async () => {
    const accounts = await import('./reviewer-account-repository');
    await accounts.createReviewerAccount(input(), CREATED_AT);

    expect(
      await accounts.createReviewerAccount(input({ phone: '+2348039999999' }), CREATED_AT),
    ).toEqual({ ok: false, reason: 'email_taken' });
  });

  it('rejects an unknown subject id and rolls the whole account back', async () => {
    const accounts = await import('./reviewer-account-repository');

    expect(await accounts.createReviewerAccount(input({ subjectIds: [999999] }), CREATED_AT)).toEqual(
      { ok: false, reason: 'unknown_subject' },
    );

    const users = await withClient(
      async (client) => (await client.query(`SELECT 1 FROM users`)).rowCount,
    );
    expect(users).toBe(0);
  });

  it('lists accounts with their subjects, and reflects resets and status changes', async () => {
    const accounts = await import('./reviewer-account-repository');
    const physics = await insertSubject('Physics');
    const created = await accounts.createReviewerAccount(
      input({ subjectIds: [physics] }),
      CREATED_AT,
    );
    await accounts.createReviewerAccount(
      input({
        fullName: 'Bola Ade',
        phone: '+2348030000001',
        email: 'bola@example.test',
        role: 'contributor',
      }),
      CREATED_AT,
    );
    if (!created.ok) throw new Error('unreachable');

    const listed = await accounts.listReviewerAccounts();
    expect(listed.map((a) => a.fullName)).toEqual(['Adaeze Okafor', 'Bola Ade']);
    expect(listed[0]).toEqual({
      reviewerId: created.reviewerId,
      fullName: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze@example.test',
      role: 'reviewer',
      status: 'active',
      subjects: [{ id: physics, name: 'Physics' }],
      mustChangePassword: true,
      createdAt: expect.any(String),
    });
    expect(listed[1]?.subjects).toEqual([]);

    expect(await accounts.setReviewerStatus(created.reviewerId, 'suspended')).toEqual({ ok: true });
    expect((await accounts.listReviewerAccounts())[0]?.status).toBe('suspended');
  });

  it('issues a new temporary password on reset, invalidating the old one', async () => {
    const accounts = await import('./reviewer-account-repository');
    const auth = await import('./reviewer-auth-repository');
    const created = await accounts.createReviewerAccount(input(), CREATED_AT, () => 'TempPass2345');
    if (!created.ok) throw new Error('unreachable');
    await auth.changeOwnPassword(created.reviewerId, 'TempPass2345', 'my-own-secret');

    expect(await accounts.resetReviewerPassword(created.reviewerId, () => 'FreshPass678')).toEqual({
      ok: true,
      temporaryPassword: 'FreshPass678',
    });

    expect(await auth.authenticateReviewer('adaeze@example.test', 'my-own-secret')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect(await auth.authenticateReviewer('adaeze@example.test', 'FreshPass678')).toMatchObject({
      ok: true,
      mustChangePassword: true,
    });
  });

  it('refuses to reset or change the status of a content_lead or removed account', async () => {
    const accounts = await import('./reviewer-account-repository');
    const { insertReviewerWithRole } = await import('./review-queue.fixtures');
    const lead = await withClient((client) =>
      insertReviewerWithRole(client, 'Lead', '+2348030000009', 'content_lead'),
    );
    const removed = await accounts.createReviewerAccount(input(), CREATED_AT);
    if (!removed.ok) throw new Error('unreachable');
    await withClient((client) =>
      client.query(`UPDATE reviewers SET status = 'removed' WHERE id = $1`, [removed.reviewerId]),
    );

    for (const reviewerId of [lead.reviewerId, removed.reviewerId]) {
      expect(await accounts.resetReviewerPassword(reviewerId)).toEqual({
        ok: false,
        reason: 'not_manageable',
      });
      expect(await accounts.setReviewerStatus(reviewerId, 'active')).toEqual({
        ok: false,
        reason: 'not_manageable',
      });
    }

    const status = await withClient(
      async (client) =>
        (
          await client.query<{ status: string }>(`SELECT status FROM reviewers WHERE id = $1`, [
            removed.reviewerId,
          ])
        ).rows[0]?.status,
    );
    expect(status).toBe('removed');
  });

  it('reports not_found for an account that does not exist', async () => {
    const accounts = await import('./reviewer-account-repository');
    expect(await accounts.resetReviewerPassword(999999)).toEqual({ ok: false, reason: 'not_found' });
    expect(await accounts.setReviewerStatus(999999, 'active')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('lists subjects alphabetically', async () => {
    const accounts = await import('./reviewer-account-repository');
    const physics = await insertSubject('Physics');
    const biology = await insertSubject('Biology');

    expect(await accounts.listSubjects()).toEqual([
      { id: biology, name: 'Biology' },
      { id: physics, name: 'Physics' },
    ]);
  });
});
