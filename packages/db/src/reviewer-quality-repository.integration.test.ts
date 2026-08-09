import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('scoreGoldDecision', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      quality: typeof import('./reviewer-quality-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const quality = await import('./reviewer-quality-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, quality });
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

  it('records no score row for an ordinary, non-gold item, and leaves accuracy_score unaffected', async () => {
    await withWorld(async ({ client, world, fixtures, quality }) => {
      const itemId = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const decisionRow = await client.query<{ id: number }>(
        `SELECT id FROM review_decisions WHERE item_id = $1`,
        [itemId],
      );

      await quality.scoreGoldDecision(client, itemId, world.reviewerId, decisionRow.rows[0]!.id, {
        action: 'approve',
      });

      const scores = await client.query('SELECT 1 FROM gold_item_scores WHERE item_id = $1', [
        itemId,
      ]);
      expect(scores.rowCount).toBe(0);

      // No prior gold history for this reviewer, so the unconditional
      // recompute (run for query-count/timing symmetry with the gold path)
      // still writes NULL, not a fabricated score.
      const reviewer = await client.query<{ accuracy_score: string | null }>(
        `SELECT accuracy_score FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(reviewer.rows[0]?.accuracy_score).toBeNull();
    });
  });

  it('a non-gold decision still rewrites accuracy_score to the same recomputed value, for query-count symmetry with a gold decision', async () => {
    await withWorld(async ({ client, world, fixtures, quality }) => {
      const gold = await fixtures.insertQueueItem(client, world, {
        gold: { referenceDecision: 'approve', referenceKey: 'A', plantedErrorType: null },
      });
      await fixtures.insertDecision(client, gold, world.reviewerId, 'approve');
      const goldDecisionId = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          gold,
        ])
      ).rows[0]!.id;
      await quality.scoreGoldDecision(client, gold, world.reviewerId, goldDecisionId, {
        action: 'approve',
      });

      const ordinary = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, ordinary, world.reviewerId, 'approve');
      const ordinaryDecisionId = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          ordinary,
        ])
      ).rows[0]!.id;
      await quality.scoreGoldDecision(client, ordinary, world.reviewerId, ordinaryDecisionId, {
        action: 'approve',
      });

      // Still 1/1 — the non-gold decision recorded no gold_item_scores row,
      // so the recompute it triggered wrote back the same value the gold
      // decision alone had already produced.
      const reviewer = await client.query<{ accuracy_score: string }>(
        `SELECT accuracy_score FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(Number(reviewer.rows[0]?.accuracy_score)).toBe(1);
    });
  });

  it('records agreement and updates accuracy_score when the reviewer agrees with a gold item', async () => {
    await withWorld(async ({ client, world, fixtures, quality }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        gold: { referenceDecision: 'approve', referenceKey: 'A', plantedErrorType: null },
      });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const decisionId = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          itemId,
        ])
      ).rows[0]!.id;

      await quality.scoreGoldDecision(client, itemId, world.reviewerId, decisionId, {
        action: 'approve',
      });

      const score = await client.query<{ agreed: boolean; review_decision_id: number }>(
        `SELECT agreed, review_decision_id FROM gold_item_scores WHERE item_id = $1`,
        [itemId],
      );
      expect(score.rows[0]).toEqual({ agreed: true, review_decision_id: decisionId });

      const reviewer = await client.query<{ accuracy_score: string }>(
        `SELECT accuracy_score FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(Number(reviewer.rows[0]?.accuracy_score)).toBe(1);
    });
  });

  it('records disagreement and drops accuracy_score when the reviewer misses a planted defect', async () => {
    await withWorld(async ({ client, world, fixtures, quality }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        gold: { referenceDecision: 'reject', referenceKey: 'A', plantedErrorType: 'wrong_key' },
      });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const decisionId = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          itemId,
        ])
      ).rows[0]!.id;

      await quality.scoreGoldDecision(client, itemId, world.reviewerId, decisionId, {
        action: 'approve',
      });

      const score = await client.query<{ agreed: boolean }>(
        `SELECT agreed FROM gold_item_scores WHERE item_id = $1`,
        [itemId],
      );
      expect(score.rows[0]?.agreed).toBe(false);

      const reviewer = await client.query<{ accuracy_score: string }>(
        `SELECT accuracy_score FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(Number(reviewer.rows[0]?.accuracy_score)).toBe(0);
    });
  });

  it('accuracy_score is the rolling average across every gold decision this reviewer has made', async () => {
    await withWorld(async ({ client, world, fixtures, quality }) => {
      const goldOptions = {
        gold: { referenceDecision: 'approve' as const, referenceKey: 'A', plantedErrorType: null },
      };

      const agree1 = await fixtures.insertQueueItem(client, world, goldOptions);
      await fixtures.insertDecision(client, agree1, world.reviewerId, 'approve');
      const agree1Id = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          agree1,
        ])
      ).rows[0]!.id;
      await quality.scoreGoldDecision(client, agree1, world.reviewerId, agree1Id, {
        action: 'approve',
      });

      const disagree = await fixtures.insertQueueItem(client, world, goldOptions);
      await fixtures.insertDecision(client, disagree, world.reviewerId, 'reject');
      const disagreeId = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          disagree,
        ])
      ).rows[0]!.id;
      await quality.scoreGoldDecision(client, disagree, world.reviewerId, disagreeId, {
        action: 'reject',
      });

      const agree2 = await fixtures.insertQueueItem(client, world, goldOptions);
      await fixtures.insertDecision(client, agree2, world.reviewerId, 'approve');
      const agree2Id = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          agree2,
        ])
      ).rows[0]!.id;
      await quality.scoreGoldDecision(client, agree2, world.reviewerId, agree2Id, {
        action: 'approve',
      });

      const reviewer = await client.query<{ accuracy_score: string }>(
        `SELECT accuracy_score FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      // 2 agreements out of 3 gold decisions.
      expect(Number(reviewer.rows[0]?.accuracy_score)).toBeCloseTo(2 / 3, 3);
    });
  });
});
