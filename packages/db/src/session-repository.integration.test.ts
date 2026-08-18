import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { computeEffectiveNow, computeRemainingSeconds, computeSessionEndAt } from '@jamb/shared';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('session-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./exam-session.fixtures').ExamWorld;
      repo: typeof import('./session-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const { seedExamWorld } = await import('./exam-session.fixtures');
    const repo = await import('./session-repository');
    const client = await pool.connect();

    try {
      const world = await seedExamWorld(client);
      return await run({ client, world, repo });
    } finally {
      client.release();
    }
  }

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

  describe('startSession', () => {
    it('is idempotent on clientSessionId — a retry returns the same session', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const input = {
          userId: world.userId,
          examConfigId: world.examConfigId,
          mode: 'mock' as const,
          deviceId: 'device-1',
          clientSessionId: 'client-session-abc',
          startedAt: new Date('2026-05-01T09:00:00.000Z'),
        };

        const first = await repo.startSession(input, client);
        const retry = await repo.startSession(input, client);

        expect(retry).toBe(first);
        const count = await client.query(`SELECT count(*) FROM sessions WHERE client_session_id = $1`, [
          input.clientSessionId,
        ]);
        expect(Number(count.rows[0]!.count)).toBe(1);
      });
    });
  });

  describe('endSession', () => {
    it('returns the session\'s own mode, so a caller can decide whether scoreSession even applies', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const mockSessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'client-session-mock',
            startedAt: new Date('2026-05-01T09:00:00.000Z'),
          },
          client,
        );
        const practiceSessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'practice',
            deviceId: 'device-1',
            clientSessionId: 'client-session-practice',
            startedAt: new Date('2026-05-01T09:00:00.000Z'),
          },
          client,
        );

        await expect(repo.endSession(mockSessionId, new Date(), client)).resolves.toEqual({
          mode: 'mock',
        });
        await expect(repo.endSession(practiceSessionId, new Date(), client)).resolves.toEqual({
          mode: 'practice',
        });
      });
    });
  });

  describe('recordAttempt', () => {
    it('DECISION: recomputes correctness server-side, never trusting the caller', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const sessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'session-correctness',
            startedAt: new Date(),
          },
          client,
        );

        // The item's correct option is 'A' (exam-session.fixtures.ts). Chosen
        // option here is 'B' — deliberately wrong, and nothing in
        // RecordAttemptInput even has a field for the caller to claim
        // otherwise; correctness can only come from the server's own lookup.
        const attemptId = await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.englishItemId,
            userId: world.userId,
            chosenOption: 'B',
            secondsTaken: 30,
            flagged: false,
            answeredAt: new Date(),
            idempotencyKey: 'attempt-1',
          },
          client,
        );

        const row = (
          await client.query<{ is_correct: boolean }>(`SELECT is_correct FROM attempts WHERE id = $1`, [
            attemptId,
          ])
        ).rows[0]!;
        expect(row.is_correct).toBe(false);
      });
    });

    it('is idempotent on idempotencyKey — a retry never double-records', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const sessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'session-idempotent',
            startedAt: new Date(),
          },
          client,
        );
        const input = {
          sessionId,
          itemId: world.itemIds.englishItemId,
          userId: world.userId,
          chosenOption: 'A' as const,
          secondsTaken: 30,
          flagged: false,
          answeredAt: new Date(),
          idempotencyKey: 'attempt-retry',
        };

        const first = await repo.recordAttempt(input, client);
        const retry = await repo.recordAttempt(input, client);

        expect(retry).toBe(first);
        const count = await client.query(`SELECT count(*) FROM attempts WHERE idempotency_key = $1`, [
          input.idempotencyKey,
        ]);
        expect(Number(count.rows[0]!.count)).toBe(1);
      });
    });
  });

  describe('loadSessionForResume', () => {
    it('assigns an increasing sequence to each re-answer of the same item, in insertion order', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const sessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'session-resume',
            startedAt: new Date('2026-05-01T09:00:00.000Z'),
          },
          client,
        );

        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.englishItemId,
            userId: world.userId,
            chosenOption: 'B',
            secondsTaken: 20,
            flagged: false,
            answeredAt: new Date('2026-05-01T09:01:00.000Z'),
            idempotencyKey: 'resume-1',
          },
          client,
        );
        // A changed answer to the same item — a new row, never an update
        // (attempts are append-only).
        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.englishItemId,
            userId: world.userId,
            chosenOption: 'A',
            secondsTaken: 10,
            flagged: true,
            answeredAt: new Date('2026-05-01T09:02:00.000Z'),
            idempotencyKey: 'resume-2',
          },
          client,
        );

        const resumed = await repo.loadSessionForResume('session-resume', client);
        expect(resumed).not.toBeNull();
        expect(resumed!.sessionId).toBe(sessionId);
        expect(resumed!.attempts.map((a) => ({ sequence: a.sequence, chosenOption: a.chosenOption }))).toEqual(
          [
            { sequence: 1, chosenOption: 'B' },
            { sequence: 2, chosenOption: 'A' },
          ],
        );
      });
    });

    it('returns null for an unknown clientSessionId', async () => {
      await withWorld(async ({ client, repo }) => {
        expect(await repo.loadSessionForResume('does-not-exist', client)).toBeNull();
      });
    });
  });

  describe('scoreSession', () => {
    it('scores a full 4-subject session using the real ExamConfig and the latest answer per item', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const sessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'session-score',
            startedAt: new Date(),
          },
          client,
        );

        // English item: correct.
        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.englishItemId,
            userId: world.userId,
            chosenOption: 'A',
            secondsTaken: 30,
            flagged: false,
            answeredAt: new Date(),
            idempotencyKey: 'score-english',
          },
          client,
        );
        // Elective 1: wrong, then corrected — only the latest should count.
        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.electiveItemIds[0],
            userId: world.userId,
            chosenOption: 'B',
            secondsTaken: 20,
            flagged: false,
            answeredAt: new Date(),
            idempotencyKey: 'score-elective1-first',
          },
          client,
        );
        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.electiveItemIds[0],
            userId: world.userId,
            chosenOption: 'A',
            secondsTaken: 15,
            flagged: false,
            answeredAt: new Date(),
            idempotencyKey: 'score-elective1-second',
          },
          client,
        );
        // Elective 2 and 3: left unanswered entirely.

        const result = await repo.scoreSession(sessionId, client);

        expect(result.aggregateMaxMarks).toBe(400);
        const englishScore = result.subjectScores.find((s) => s.subjectId === world.englishSubjectId)!;
        expect(englishScore.score).toBeGreaterThan(0);
        const elective1Score = result.subjectScores.find(
          (s) => s.subjectId === world.electiveSubjectIds[0],
        )!;
        expect(elective1Score.score).toBeGreaterThan(0); // the corrected answer, not the first wrong one
      });
    });
  });

  describe('the release-gating scenario: force-close at minute 70, relaunch, resume', () => {
    it('recomputes correct remaining time and keeps every prior answer intact after a simulated force-close', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const startedAt = new Date('2026-05-01T09:00:00.000Z');
        const sessionId = await repo.startSession(
          {
            userId: world.userId,
            examConfigId: world.examConfigId,
            mode: 'mock',
            deviceId: 'device-1',
            clientSessionId: 'session-gating',
            startedAt,
          },
          client,
        );

        // Answer two items before the (simulated) force-close.
        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.englishItemId,
            userId: world.userId,
            chosenOption: 'A',
            secondsTaken: 40,
            flagged: false,
            answeredAt: new Date('2026-05-01T09:05:00.000Z'),
            idempotencyKey: 'gating-1',
          },
          client,
        );
        await repo.recordAttempt(
          {
            sessionId,
            itemId: world.itemIds.electiveItemIds[0],
            userId: world.userId,
            chosenOption: 'C',
            secondsTaken: 55,
            flagged: true,
            answeredAt: new Date('2026-05-01T09:10:00.000Z'),
            idempotencyKey: 'gating-2',
          },
          client,
        );

        // Force-close at minute 70: the client's last-persisted local state
        // was {endAt, lastObservedAt}, both computed once at session start
        // and never touched again until this moment.
        const totalDurationMinutes = 120;
        const endAt = computeSessionEndAt(startedAt, totalDurationMinutes);
        const lastObservedAtBeforeClose = new Date(startedAt.getTime() + 70 * 60_000);

        // --- everything in-memory is discarded here; only {endAt,
        // lastObservedAtBeforeClose} and the database survive. ---

        // Relaunch: reload from the repository alone.
        const resumed = await repo.loadSessionForResume('session-gating', client);
        expect(resumed).not.toBeNull();

        // The device clock on relaunch reads a moment shortly after minute 70.
        const actualNowOnRelaunch = new Date(startedAt.getTime() + 70 * 60_000 + 5_000);
        const effectiveNow = computeEffectiveNow(actualNowOnRelaunch, lastObservedAtBeforeClose);
        const remainingSeconds = computeRemainingSeconds(endAt, effectiveNow);

        // 120 minutes total, 70 minutes plus 5 seconds elapsed.
        expect(remainingSeconds).toBe(50 * 60 - 5);

        // Every prior answer is intact.
        expect(resumed!.attempts).toHaveLength(2);
        expect(resumed!.attempts.map((a) => ({ itemId: a.itemId, chosenOption: a.chosenOption, flagged: a.flagged }))).toEqual(
          [
            { itemId: world.itemIds.englishItemId, chosenOption: 'A', flagged: false },
            { itemId: world.itemIds.electiveItemIds[0], chosenOption: 'C', flagged: true },
          ],
        );

        // And even if the device clock were wound backward after relaunch
        // (rather than forward), the ratchet refuses to hand back time
        // already spent.
        const rolledBackClock = new Date(startedAt.getTime()); // pretends it's still minute 0
        const effectiveNowAfterRollback = computeEffectiveNow(rolledBackClock, lastObservedAtBeforeClose);
        expect(computeRemainingSeconds(endAt, effectiveNowAfterRollback)).toBe(50 * 60);
      });
    });
  });
});
