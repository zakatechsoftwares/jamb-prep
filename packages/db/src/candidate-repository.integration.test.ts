import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * `findOrCreateCandidate` (progress sync, plan 8.3) against a real
 * database — proving the idempotent-on-phone registration contract that
 * `apps/api`'s `/candidate/register` route rests on.
 */
describe.runIf(hasDatabase)('candidate-repository', () => {
  beforeEach(async () => {
    const { pool } = await import('./client');
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const { pool } = await import('./client');
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('creates a new users row on first registration', async () => {
    const { findOrCreateCandidate } = await import('./candidate-repository');
    const { pool } = await import('./client');

    const { userId } = await findOrCreateCandidate({
      fullName: 'Ada Candidate',
      phone: '__candidate_ada__',
      examYear: 2027,
    });

    const row = (
      await pool.query<{ full_name: string; exam_year: number }>(
        `SELECT full_name, exam_year FROM users WHERE id = $1`,
        [userId],
      )
    ).rows[0]!;
    expect(row).toEqual({ full_name: 'Ada Candidate', exam_year: 2027 });
  });

  it('is idempotent on phone -- registering twice returns the same userId, not a duplicate row', async () => {
    const { findOrCreateCandidate } = await import('./candidate-repository');
    const { pool } = await import('./client');

    const first = await findOrCreateCandidate({
      fullName: 'Bello Candidate',
      phone: '__candidate_bello__',
      examYear: 2027,
    });
    const second = await findOrCreateCandidate({
      fullName: 'Bello Candidate (retry)',
      phone: '__candidate_bello__',
      examYear: 2027,
    });

    expect(second.userId).toBe(first.userId);
    const count = (
      await pool.query<{ count: string }>(`SELECT count(*) AS count FROM users WHERE phone = $1`, [
        '__candidate_bello__',
      ])
    ).rows[0]!;
    expect(Number(count.count)).toBe(1);
  });

  it('a different phone always gets a different userId', async () => {
    const { findOrCreateCandidate } = await import('./candidate-repository');

    const a = await findOrCreateCandidate({ fullName: 'A', phone: '__candidate_a__', examYear: 2027 });
    const b = await findOrCreateCandidate({ fullName: 'B', phone: '__candidate_b__', examYear: 2027 });

    expect(a.userId).not.toBe(b.userId);
  });

  it(
    'end to end: a registered candidate starts a session, records attempts, ends, and is scored -- ' +
      'against real seeded items and exam config, the same prerequisites session 12 already established',
    async () => {
      const { findOrCreateCandidate } = await import('./candidate-repository');
      const { seedExamWorld } = await import('./exam-session.fixtures');
      const { startSession, recordAttempt, endSession, scoreSession } = await import(
        './session-repository'
      );
      const { pool } = await import('./client');
      const client = await pool.connect();

      try {
        const world = await seedExamWorld(client);

        // A freshly-registered candidate has no subject_combination_id --
        // that's a content/onboarding step this session deliberately
        // leaves out of scope. Assigning it directly here simulates what a
        // future onboarding step would do, so the sync mechanism itself
        // (registration -> session -> attempts -> score) can be proven
        // correct against realistic data without building that step now.
        const { userId } = await findOrCreateCandidate(
          { fullName: 'Chidi Candidate', phone: '__candidate_chidi__', examYear: 2026 },
          client,
        );
        await client.query(`UPDATE users SET subject_combination_id = $2 WHERE id = $1`, [
          userId,
          (
            await client.query<{ subject_combination_id: number }>(
              `SELECT subject_combination_id FROM users WHERE id = $1`,
              [world.userId],
            )
          ).rows[0]!.subject_combination_id,
        ]);

        const sessionId = await startSession(
          {
            userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'client-session-chidi-1',
            startedAt: new Date('2026-08-19T08:00:00.000Z'),
          },
          client,
        );

        await recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.englishItemId,
            userId,
            chosenOption: 'A', // correct, per exam-session.fixtures.ts's insertItem
            secondsTaken: 30,
            flagged: false,
            answeredAt: new Date('2026-08-19T08:01:00.000Z'),
            idempotencyKey: 'attempt-chidi-english-1',
          },
          client,
        );
        await recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.electiveItemIds[0],
            userId,
            chosenOption: 'B', // wrong
            secondsTaken: 45,
            flagged: false,
            answeredAt: new Date('2026-08-19T08:02:00.000Z'),
            idempotencyKey: 'attempt-chidi-elective-1',
          },
          client,
        );

        await endSession(sessionId, new Date('2026-08-19T08:10:00.000Z'), client);
        const score = await scoreSession(sessionId, client);

        const englishScore = score.subjectScores.find((s) => s.subjectId === world.englishSubjectId);
        const electiveScore = score.subjectScores.find(
          (s) => s.subjectId === world.electiveSubjectIds[0],
        );
        expect(englishScore?.score).toBeGreaterThan(0);
        expect(electiveScore?.score).toBe(0);
      } finally {
        client.release();
      }
    },
  );
});
