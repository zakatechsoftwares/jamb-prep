import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('interRaterAgreementBySubject', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      repo: typeof import('./inter-rater-agreement-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const repo = await import('./inter-rater-agreement-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, repo });
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

  it('ignores an item with only one decision — there is no pair to agree or disagree', async () => {
    await withWorld(async ({ client, world, fixtures, repo }) => {
      const itemId = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');

      const result = await repo.interRaterAgreementBySubject(client);
      expect(result).toEqual([]);
    });
  });

  it('pairs the two live decisions on the same item and reports agreement for the subject', async () => {
    await withWorld(async ({ client, world, fixtures, repo }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { subjectId: world.subjectId });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      await fixtures.insertDecision(client, itemId, world.secondReviewerId, 'approve');

      const result = await repo.interRaterAgreementBySubject(client);
      expect(result).toEqual([
        { subjectId: world.subjectId, pairCount: 1, agreementRate: 1 },
      ]);
    });
  });

  it('reports disagreement when the two reviewers reached different actions', async () => {
    await withWorld(async ({ client, world, fixtures, repo }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { subjectId: world.subjectId });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      await fixtures.insertDecision(client, itemId, world.secondReviewerId, 'reject');

      const result = await repo.interRaterAgreementBySubject(client);
      expect(result).toEqual([
        { subjectId: world.subjectId, pairCount: 1, agreementRate: 0 },
      ]);
    });
  });

  it('excludes a late-arrival decision from pairing — it never resolved the second review', async () => {
    await withWorld(async ({ client, world, fixtures, repo }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { subjectId: world.subjectId });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      await client.query(
        `INSERT INTO review_decisions (item_id, reviewer_id, action, rejection_reason, seconds_taken, idempotency_key, decision_context)
         VALUES ($1, $2, 'reject', 'wrong_key', 30, '__late_arrival_pair_test__', 'late_arrival')`,
        [itemId, world.secondReviewerId],
      );

      const result = await repo.interRaterAgreementBySubject(client);
      expect(result).toEqual([]);
    });
  });

  it('keeps subjects separate', async () => {
    await withWorld(async ({ client, world, fixtures, repo }) => {
      const item1 = await fixtures.insertQueueItem(client, world, { subjectId: world.subjectId });
      await fixtures.insertDecision(client, item1, world.reviewerId, 'approve');
      await fixtures.insertDecision(client, item1, world.secondReviewerId, 'approve');

      const item2 = await fixtures.insertQueueItem(client, world, { subjectId: world.otherSubjectId });
      await fixtures.insertDecision(client, item2, world.reviewerId, 'approve');
      await fixtures.insertDecision(client, item2, world.secondReviewerId, 'reject');

      const result = await repo.interRaterAgreementBySubject(client);
      expect(result).toContainEqual({ subjectId: world.subjectId, pairCount: 1, agreementRate: 1 });
      expect(result).toContainEqual({
        subjectId: world.otherSubjectId,
        pairCount: 1,
        agreementRate: 0,
      });
    });
  });
});
