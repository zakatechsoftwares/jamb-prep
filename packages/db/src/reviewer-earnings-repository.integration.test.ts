import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('recordEarning', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      earnings: typeof import('./reviewer-earnings-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const earnings = await import('./reviewer-earnings-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, earnings });
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

  async function decisionId(client: import('pg').PoolClient, itemId: number): Promise<number> {
    const row = await client.query<{ id: number }>(
      `SELECT id FROM review_decisions WHERE item_id = $1`,
      [itemId],
    );
    return row.rows[0]!.id;
  }

  it('pays the base rate against the active config for an ordinary low-tier decision', async () => {
    await withWorld(async ({ client, world, fixtures, earnings }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const id = await decisionId(client, itemId);

      await earnings.recordEarning(client, id, world.reviewerId, 'low', false);

      const row = await client.query<{ amount_kobo: string; rate_basis: unknown }>(
        `SELECT amount_kobo, rate_basis FROM reviewer_earnings WHERE review_decision_id = $1`,
        [id],
      );
      expect(Number(row.rows[0]?.amount_kobo)).toBe(5000);
      expect(row.rows[0]?.rate_basis).toMatchObject({
        riskTier: 'low',
        isSecondReview: false,
        configVersion: 1,
      });
    });
  });

  it('adds the high-tier bonus for a calculation item', async () => {
    await withWorld(async ({ client, world, fixtures, earnings }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const id = await decisionId(client, itemId);

      await earnings.recordEarning(client, id, world.reviewerId, 'high', false);

      const row = await client.query<{ amount_kobo: string }>(
        `SELECT amount_kobo FROM reviewer_earnings WHERE review_decision_id = $1`,
        [id],
      );
      expect(Number(row.rows[0]?.amount_kobo)).toBe(8000);
    });
  });

  it('stacks the high-tier and second-review bonuses', async () => {
    await withWorld(async ({ client, world, fixtures, earnings }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const id = await decisionId(client, itemId);

      await earnings.recordEarning(client, id, world.reviewerId, 'high', true);

      const row = await client.query<{ amount_kobo: string }>(
        `SELECT amount_kobo FROM reviewer_earnings WHERE review_decision_id = $1`,
        [id],
      );
      expect(Number(row.rows[0]?.amount_kobo)).toBe(10000);
    });
  });

  it('pays a rejection identically to an approval for the same item shape', async () => {
    await withWorld(async ({ client, world, fixtures, earnings }) => {
      const approved = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await fixtures.insertDecision(client, approved, world.reviewerId, 'approve');
      const approveId = await decisionId(client, approved);
      await earnings.recordEarning(client, approveId, world.reviewerId, 'low', false);

      const rejected = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await fixtures.insertDecision(client, rejected, world.secondReviewerId, 'reject');
      const rejectId = await decisionId(client, rejected);
      await earnings.recordEarning(client, rejectId, world.secondReviewerId, 'low', false);

      const rows = await client.query<{ amount_kobo: string }>(
        `SELECT amount_kobo FROM reviewer_earnings WHERE review_decision_id IN ($1, $2)`,
        [approveId, rejectId],
      );
      expect(rows.rows.map((r) => Number(r.amount_kobo))).toEqual([5000, 5000]);
    });
  });

  it('throws when no payment rate config is active', async () => {
    await withWorld(async ({ client, world, fixtures, earnings }) => {
      await client.query('UPDATE payment_rate_configs SET active = false');
      try {
        const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
        await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
        const id = await decisionId(client, itemId);

        await expect(
          earnings.recordEarning(client, id, world.reviewerId, 'low', false),
        ).rejects.toThrow(/active/i);
      } finally {
        // This test's own mutation would otherwise leave no config active
        // for every later test in this process — restore it.
        await client.query('UPDATE payment_rate_configs SET active = true WHERE version = 1');
      }
    });
  });
});
