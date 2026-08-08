import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// The concurrency test holds one connection per simultaneous caller, so the
// pool ceiling has to be raised before ./client is first imported — it reads
// the environment once, at module load.
process.env.PGPOOL_MAX ??= '30';

const hasDatabase = Boolean(process.env.DATABASE_URL);

// Every call is served a gold item only if the draw falls below the rate;
// these two generators pin that decision instead of leaving it to chance.
const neverGold = () => 0.999999;
const alwaysGold = () => 0;

describe.runIf(hasDatabase)('review queue', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      repository: typeof import('./review-queue-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const repository = await import('./review-queue-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, repository });
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
    const client = await pool.connect();
    try {
      const { truncateQueueWorld } = await import('./review-queue.fixtures');
      await truncateQueueWorld(client);
    } finally {
      client.release();
      await pool.end();
    }
  });

  // -------------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------------

  it('never hands the same item to two of twenty simultaneous callers', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      for (let index = 0; index < 25; index += 1) {
        await fixtures.insertQueueItem(client, world, {
          createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        });
      }

      // Twenty genuinely simultaneous calls, each on its own connection.
      const served = await Promise.all(
        Array.from({ length: 20 }, () =>
          repository.getNextItem(world.reviewerId, { random: neverGold }),
        ),
      );

      const itemIds = served.map((item) => item?.itemId);

      expect(itemIds.every((itemId) => typeof itemId === 'number')).toBe(true);
      expect(new Set(itemIds).size).toBe(20);
    });
  });

  it('serves each item once across concurrent batch requests', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      for (let index = 0; index < 20; index += 1) {
        await fixtures.insertQueueItem(client, world);
      }

      const batches = await Promise.all(
        Array.from({ length: 4 }, () =>
          repository.getNextItemBatch(world.reviewerId, 5, { random: neverGold }),
        ),
      );

      const itemIds = batches.flat().map((item) => item.itemId);

      expect(itemIds).toHaveLength(20);
      expect(new Set(itemIds).size).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // Priority order
  // -------------------------------------------------------------------------

  it('serves the priority bands in order', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const ordinary = await fixtures.insertQueueItem(client, world);
      const gateFlagged = await fixtures.insertQueueItem(client, world, { gateFlagged: true });
      const secondReview = await fixtures.insertQueueItem(client, world, {
        status: 'needs_second_review',
      });
      const highRisk = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });
      const disagreed = await fixtures.insertQueueItem(client, world, {
        independentSolveVerdict: 'disagreed',
      });

      const served = await repository.getNextItemBatch(world.reviewerId, 5, { random: neverGold });

      expect(served.map((item) => item.itemId)).toEqual([
        disagreed,
        highRisk,
        secondReview,
        gateFlagged,
        ordinary,
      ]);
    });
  });

  it('serves the oldest item first within a band', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const newest = await fixtures.insertQueueItem(client, world, {
        createdAt: '2026-03-03T00:00:00Z',
      });
      const oldest = await fixtures.insertQueueItem(client, world, {
        createdAt: '2026-01-01T00:00:00Z',
      });
      const middle = await fixtures.insertQueueItem(client, world, {
        createdAt: '2026-02-02T00:00:00Z',
      });

      const served = await repository.getNextItemBatch(world.reviewerId, 3, { random: neverGold });

      expect(served.map((item) => item.itemId)).toEqual([oldest, middle, newest]);
    });
  });

  it('does not starve the ordinary band when urgent items arrive later', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const waiting = await fixtures.insertQueueItem(client, world, {
        createdAt: '2026-01-01T00:00:00Z',
      });
      const urgent = await fixtures.insertQueueItem(client, world, {
        riskTier: 'high',
        createdAt: '2026-09-09T00:00:00Z',
      });

      const served = await repository.getNextItemBatch(world.reviewerId, 2, { random: neverGold });

      // The wave goes first, but the item that has been waiting since
      // January is next rather than being pushed back indefinitely.
      expect(served.map((item) => item.itemId)).toEqual([urgent, waiting]);
    });
  });

  // -------------------------------------------------------------------------
  // Exclusions
  // -------------------------------------------------------------------------

  it('never serves an item outside the reviewer’s subjects', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world, { subjectId: world.otherSubjectId });

      expect(await repository.getNextItem(world.reviewerId, { random: neverGold })).toBeNull();
    });
  });

  it('never serves an item the reviewer authored', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world, {
        contributorId: world.reviewerUserId,
        riskTier: 'not_generated',
      });

      expect(await repository.getNextItem(world.reviewerId, { random: neverGold })).toBeNull();
    });
  });

  it('never serves an item the reviewer has already decided on', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, itemId, world.reviewerId);

      expect(await repository.getNextItem(world.reviewerId, { random: neverGold })).toBeNull();
    });
  });

  it('never sends a second review back to the reviewer who made the first decision', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        status: 'needs_second_review',
        riskTier: 'high',
      });
      await fixtures.insertDecision(client, itemId, world.reviewerId);

      expect(await repository.getNextItem(world.reviewerId, { random: neverGold })).toBeNull();

      // The other reviewer, who has not seen it, does get it.
      const forSecond = await repository.getNextItem(world.secondReviewerId, {
        random: neverGold,
      });
      expect(forSecond?.itemId).toBe(itemId);
    });
  });

  it('never serves an unsampled low-risk item that qualifies for the automated route', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world, { sampledForReview: false });

      expect(await repository.getNextItem(world.reviewerId, { random: neverGold })).toBeNull();
    });
  });

  it('serves an unsampled low-risk item whose independent solve disagreed', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      // The sampling draw does not get to exempt a suspected wrong key.
      const itemId = await fixtures.insertQueueItem(client, world, {
        sampledForReview: false,
        independentSolveVerdict: 'disagreed',
      });

      const served = await repository.getNextItem(world.reviewerId, { random: neverGold });
      expect(served?.itemId).toBe(itemId);
    });
  });

  it('serves an unsampled low-risk item that a gate flagged', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        sampledForReview: false,
        gateFlagged: true,
      });

      const served = await repository.getNextItem(world.reviewerId, { random: neverGold });
      expect(served?.itemId).toBe(itemId);
    });
  });

  it('never serves an item that is already claimed and unexpired', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world);

      const first = await repository.getNextItem(world.reviewerId, { random: neverGold });
      expect(first).not.toBeNull();

      // Only one item exists, and it is now claimed and in_review.
      const second = await repository.getNextItem(world.secondReviewerId, { random: neverGold });
      expect(second).toBeNull();
    });
  });

  it('refuses to serve a reviewer who is not active', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world);
      await client.query(`UPDATE reviewers SET status = 'suspended' WHERE id = $1`, [
        world.reviewerId,
      ]);

      await expect(repository.getNextItem(world.reviewerId, { random: neverGold })).rejects.toThrow(
        /not active/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Claiming
  // -------------------------------------------------------------------------

  it('claims the served item and moves it to in_review, recording the transition', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world);

      const served = await repository.getNextItem(world.reviewerId, { random: neverGold });
      expect(served?.itemId).toBe(itemId);
      expect(served?.claimExpiresAt.getTime()).toBeGreaterThan(Date.now());

      const status = await client.query<{ status: string }>(
        'SELECT status FROM items WHERE id = $1',
        [itemId],
      );
      expect(status.rows[0]?.status).toBe('in_review');

      const claim = await client.query('SELECT 1 FROM review_claims WHERE item_id = $1', [itemId]);
      expect(claim.rowCount).toBe(1);

      const logged = await client.query<{ to_status: string; event: string; actor_role: string }>(
        `SELECT to_status, event, actor_role FROM item_state_transitions WHERE item_id = $1`,
        [itemId],
      );
      expect(logged.rows[0]).toMatchObject({
        to_status: 'in_review',
        event: 'claimed',
        actor_role: 'reviewer',
      });
    });
  });

  it('returns an expired claim to the queue and records why', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world);
      await repository.getNextItem(world.reviewerId, { random: neverGold });

      await client.query(
        `UPDATE review_claims
            SET claimed_at = now() - interval '2 hours',
                expires_at = now() - interval '1 minute'
          WHERE item_id = $1`,
        [itemId],
      );

      expect(await repository.releaseExpiredClaims()).toBe(1);

      const status = await client.query<{ status: string }>(
        'SELECT status FROM items WHERE id = $1',
        [itemId],
      );
      expect(status.rows[0]?.status).toBe('pending_review');

      const logged = await client.query<{ event: string; to_status: string }>(
        `SELECT event, to_status FROM item_state_transitions
          WHERE item_id = $1 ORDER BY id DESC LIMIT 1`,
        [itemId],
      );
      expect(logged.rows[0]).toMatchObject({ event: 'claim_expired', to_status: 'pending_review' });

      // And it is servable again.
      const reserved = await repository.getNextItem(world.secondReviewerId, { random: neverGold });
      expect(reserved?.itemId).toBe(itemId);
    });
  });

  it('returns a lapsed second review to needs_second_review, not to the ordinary queue', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        status: 'needs_second_review',
        riskTier: 'high',
      });
      await fixtures.insertDecision(client, itemId, world.secondReviewerId);

      await repository.getNextItem(world.reviewerId, { random: neverGold });
      await client.query(
        `UPDATE review_claims
            SET claimed_at = now() - interval '2 hours',
                expires_at = now() - interval '1 minute'
          WHERE item_id = $1`,
        [itemId],
      );

      await repository.releaseExpiredClaims();

      const status = await client.query<{ status: string }>(
        'SELECT status FROM items WHERE id = $1',
        [itemId],
      );
      expect(status.rows[0]?.status).toBe('needs_second_review');
    });
  });

  // -------------------------------------------------------------------------
  // Gold items
  // -------------------------------------------------------------------------

  it('serves a gold item when the draw calls for one', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const ordinary = await fixtures.insertQueueItem(client, world, {
        createdAt: '2026-01-01T00:00:00Z',
      });
      const gold = await fixtures.insertQueueItem(client, world, {
        gold: true,
        createdAt: '2026-06-01T00:00:00Z',
      });

      // The gold item is newer, so only the injection draw can explain it
      // being served ahead of the ordinary one.
      const served = await repository.getNextItem(world.reviewerId, { random: alwaysGold });

      expect(served?.itemId).toBe(gold);
      expect(served?.itemId).not.toBe(ordinary);
    });
  });

  it('serves an ordinary item when the draw does not call for gold', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const ordinary = await fixtures.insertQueueItem(client, world);
      await fixtures.insertQueueItem(client, world, { gold: true });

      const served = await repository.getNextItem(world.reviewerId, { random: neverGold });

      expect(served?.itemId).toBe(ordinary);
    });
  });

  it('falls back to an ordinary item when the draw wants gold and none is available', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const ordinary = await fixtures.insertQueueItem(client, world);

      const served = await repository.getNextItem(world.reviewerId, { random: alwaysGold });

      expect(served?.itemId).toBe(ordinary);
    });
  });

  it('never serves a gold item the reviewer has already decided on', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      // Otherwise one judgement is counted twice in the accuracy score
      // that reviewer standing and pay depend on.
      const gold = await fixtures.insertQueueItem(client, world, { gold: true });
      await fixtures.insertDecision(client, gold, world.reviewerId);

      expect(await repository.getNextItem(world.reviewerId, { random: alwaysGold })).toBeNull();
    });
  });

  it('never serves a gold item the reviewer authored', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world, {
        gold: true,
        contributorId: world.reviewerUserId,
      });

      expect(await repository.getNextItem(world.reviewerId, { random: alwaysGold })).toBeNull();
    });
  });

  it('returns a gold item in exactly the same shape as an ordinary one', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world, { gold: true });
      const goldServed = await repository.getNextItem(world.reviewerId, { random: alwaysGold });

      await fixtures.insertQueueItem(client, world);
      const ordinaryServed = await repository.getNextItem(world.secondReviewerId, {
        random: neverGold,
      });

      expect(goldServed).not.toBeNull();
      expect(ordinaryServed).not.toBeNull();
      // Identical key sets: nothing in the payload betrays which is which.
      expect(Object.keys(goldServed ?? {}).sort()).toEqual(
        Object.keys(ordinaryServed ?? {}).sort(),
      );
      expect(JSON.stringify(goldServed)).not.toMatch(/gold|reference_|planted/i);
    });
  });

  it('counts a gold stock-out when the draw fires and no gold item is available', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      // Running dry is invisible from the outside: the reviewer is served an
      // ordinary item and the request succeeds, while accuracy measurement
      // quietly stops. The counter is the only thing that surfaces it.
      const ordinary = await fixtures.insertQueueItem(client, world);
      const before = new Date(Date.now() - 60_000);

      const served = await repository.getNextItem(world.reviewerId, { random: alwaysGold });
      expect(served?.itemId).toBe(ordinary);

      const stockouts = await repository.goldStockoutsSince(before);
      expect(stockouts).toEqual([{ reviewerId: world.reviewerId, occurrences: 1 }]);
    });
  });

  it('counts a stock-out when the reviewer has exhausted the gold items in their subjects', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      // Stock exists, but not for this reviewer — a different problem from a
      // global stock-out, which is why the count is per reviewer.
      const gold = await fixtures.insertQueueItem(client, world, { gold: true });
      await fixtures.insertDecision(client, gold, world.reviewerId);
      await fixtures.insertQueueItem(client, world);
      const before = new Date(Date.now() - 60_000);

      await repository.getNextItem(world.reviewerId, { random: alwaysGold });

      const stockouts = await repository.goldStockoutsSince(before);
      expect(stockouts).toEqual([{ reviewerId: world.reviewerId, occurrences: 1 }]);
    });
  });

  it('counts nothing when a gold item was available, or when the draw never fired', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      await fixtures.insertQueueItem(client, world, { gold: true });
      await fixtures.insertQueueItem(client, world);
      const before = new Date(Date.now() - 60_000);

      await repository.getNextItem(world.reviewerId, { random: alwaysGold });
      await repository.getNextItem(world.secondReviewerId, { random: neverGold });

      expect(await repository.goldStockoutsSince(before)).toEqual([]);
    });
  });

  it('counts a stock-out per affected serve across a batch', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      for (let index = 0; index < 3; index += 1) {
        await fixtures.insertQueueItem(client, world);
      }
      const before = new Date(Date.now() - 60_000);

      await repository.getNextItemBatch(world.reviewerId, 3, { random: alwaysGold });

      expect(await repository.goldStockoutsSince(before)).toEqual([
        { reviewerId: world.reviewerId, occurrences: 3 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Batch
  // -------------------------------------------------------------------------

  it('returns a batch in queue order for offline caching', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const ordinary = await fixtures.insertQueueItem(client, world);
      const urgent = await fixtures.insertQueueItem(client, world, {
        independentSolveVerdict: 'disagreed',
      });

      const served = await repository.getNextItemBatch(world.reviewerId, 5, { random: neverGold });

      expect(served.map((item) => item.itemId)).toEqual([urgent, ordinary]);
    });
  });

  it('claims every item in a batch, so a cached batch is nobody else’s', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      for (let index = 0; index < 3; index += 1) {
        await fixtures.insertQueueItem(client, world);
      }

      const served = await repository.getNextItemBatch(world.reviewerId, 3, { random: neverGold });
      expect(served).toHaveLength(3);

      const claims = await client.query('SELECT 1 FROM review_claims');
      expect(claims.rowCount).toBe(3);

      expect(
        await repository.getNextItem(world.secondReviewerId, { random: neverGold }),
      ).toBeNull();
    });
  });

  it('refuses a batch larger than the configured maximum', async () => {
    await withWorld(async ({ world, repository }) => {
      const config = await repository.loadActiveQueueConfig();

      await expect(
        repository.getNextItemBatch(world.reviewerId, config.batchMaxSize + 1, {
          random: neverGold,
        }),
      ).rejects.toThrow(/batch_max_size/i);
    });
  });

  // -------------------------------------------------------------------------
  // The gate flag and the audit trail agree
  // -------------------------------------------------------------------------

  it('sets gate_flagged in the same transaction as the routed_for_judgement transition', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { status: 'gate_failed' });

      await repository.flagForJudgement(itemId, {
        userId: world.secondReviewerUserId,
        role: 'content_lead',
      });

      const row = await client.query<{ status: string; gate_flagged: boolean }>(
        'SELECT status, gate_flagged FROM items WHERE id = $1',
        [itemId],
      );
      expect(row.rows[0]).toMatchObject({ status: 'pending_review', gate_flagged: true });

      const logged = await client.query<{ event: string; from_status: string; to_status: string }>(
        `SELECT event, from_status, to_status FROM item_state_transitions WHERE item_id = $1`,
        [itemId],
      );
      expect(logged.rows[0]).toMatchObject({
        event: 'routed_for_judgement',
        from_status: 'gate_failed',
        to_status: 'pending_review',
      });
    });
  });

  it('leaves no gate_flagged item without a matching transition, and vice versa', async () => {
    await withWorld(async ({ client, world, fixtures, repository }) => {
      const flagged = await fixtures.insertQueueItem(client, world, { status: 'gate_failed' });
      await fixtures.insertQueueItem(client, world);
      await repository.flagForJudgement(flagged, {
        userId: world.reviewerUserId,
        role: 'content_lead',
      });

      // The flag is a denormalisation of what the log already implies, so
      // the two must describe exactly the same set of items.
      const disagreements = await client.query<{ id: number }>(
        `SELECT i.id FROM items i
          WHERE i.gate_flagged <> EXISTS (
                  SELECT 1 FROM item_state_transitions t
                   WHERE t.item_id = i.id AND t.event = 'routed_for_judgement'
                )`,
      );

      expect(disagreements.rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration is data
  // -------------------------------------------------------------------------

  it('reads the rates from the active configuration rather than a constant', async () => {
    await withWorld(async ({ client, repository }) => {
      const before = await repository.loadActiveQueueConfig();
      expect(before.lowRiskSampleRate).toBeGreaterThan(0);

      await client.query(
        `UPDATE review_queue_configs SET gold_item_rate = 0.2, claim_duration_minutes = 45
          WHERE active`,
      );

      const after = await repository.loadActiveQueueConfig();
      expect(after.goldItemRate).toBe(0.2);
      expect(after.claimDurationMinutes).toBe(45);

      await client.query(
        `UPDATE review_queue_configs SET gold_item_rate = $1, claim_duration_minutes = $2
          WHERE active`,
        [before.goldItemRate, before.claimDurationMinutes],
      );
    });
  });
});
