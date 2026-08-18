import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Subject-combination onboarding (the structural prerequisite content
 * sync's own build-log entry named as the real blocker to Mock mode)
 * against a real database, reusing `review-queue.fixtures.ts`'s
 * `seedQueueWorld` (Physics/Biology subjects, one candidate-shaped user
 * with no subject_combination_id set, matching every real candidate
 * today) the same way every other content-facing integration test in
 * this package already does.
 */
describe.runIf(hasDatabase)('subject-combination-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      repo: typeof import('./subject-combination-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const { seedQueueWorld } = await import('./review-queue.fixtures');
    const repo = await import('./subject-combination-repository');
    const client = await pool.connect();

    try {
      const world = await seedQueueWorld(client);
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

  async function insertCombination(
    client: import('pg').PoolClient,
    courseName: string,
    compulsorySubjectId: number,
    electiveSubjectIds: number[],
  ): Promise<number> {
    const combinationId = (
      await client.query<{ id: number }>(
        `INSERT INTO subject_combinations (course_name) VALUES ($1) RETURNING id`,
        [courseName],
      )
    ).rows[0]!.id;

    await client.query(
      `INSERT INTO subject_combination_subjects (subject_combination_id, subject_id, role)
       VALUES ($1, $2, 'compulsory')`,
      [combinationId, compulsorySubjectId],
    );
    for (const subjectId of electiveSubjectIds) {
      await client.query(
        `INSERT INTO subject_combination_subjects (subject_combination_id, subject_id, role)
         VALUES ($1, $2, 'elective')`,
        [combinationId, subjectId],
      );
    }

    return combinationId;
  }

  describe('listSubjectCombinations', () => {
    it('returns each combination with its subjects and roles', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const combinationId = await insertCombination(client, 'Medicine and Surgery', world.subjectId, [
          world.otherSubjectId,
        ]);

        const combinations = await repo.listSubjectCombinations(client);

        expect(combinations).toHaveLength(1);
        expect(combinations[0]).toMatchObject({ id: combinationId, courseName: 'Medicine and Surgery' });
        expect(combinations[0]!.subjects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ subjectId: world.subjectId, role: 'compulsory' }),
            expect.objectContaining({ subjectId: world.otherSubjectId, role: 'elective' }),
          ]),
        );
      });
    });

    it('returns an empty list when nothing is seeded', async () => {
      await withWorld(async ({ client, repo }) => {
        expect(await repo.listSubjectCombinations(client)).toEqual([]);
      });
    });
  });

  describe('setCandidateSubjectCombination', () => {
    it('assigns the combination to the candidate', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const combinationId = await insertCombination(client, 'Medicine and Surgery', world.subjectId, [
          world.otherSubjectId,
        ]);

        await repo.setCandidateSubjectCombination(world.reviewerUserId, combinationId, client);

        const row = (
          await client.query<{ subject_combination_id: number }>(
            `SELECT subject_combination_id FROM users WHERE id = $1`,
            [world.reviewerUserId],
          )
        ).rows[0]!;
        expect(row.subject_combination_id).toBe(combinationId);
      });
    });

    it('is freely reassignable', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const first = await insertCombination(client, 'Medicine and Surgery', world.subjectId, [
          world.otherSubjectId,
        ]);
        const second = await insertCombination(client, 'Computer Science', world.subjectId, [
          world.otherSubjectId,
        ]);

        await repo.setCandidateSubjectCombination(world.reviewerUserId, first, client);
        await repo.setCandidateSubjectCombination(world.reviewerUserId, second, client);

        const row = (
          await client.query<{ subject_combination_id: number }>(
            `SELECT subject_combination_id FROM users WHERE id = $1`,
            [world.reviewerUserId],
          )
        ).rows[0]!;
        expect(row.subject_combination_id).toBe(second);
      });
    });

    it('throws SubjectCombinationNotFoundError for an unknown id', async () => {
      await withWorld(async ({ world, repo }) => {
        await expect(
          repo.setCandidateSubjectCombination(world.reviewerUserId, 999999),
        ).rejects.toThrow(repo.SubjectCombinationNotFoundError);
      });
    });
  });
});
