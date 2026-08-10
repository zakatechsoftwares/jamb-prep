import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('sweepReviewerAccuracy', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      sweep: typeof import('./accuracy-threshold-sweep');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const sweep = await import('./accuracy-threshold-sweep');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, sweep });
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

  async function setAccuracy(
    client: import('pg').PoolClient,
    reviewerId: number,
    accuracy: number | null,
    consecutiveFailures = 0,
  ): Promise<void> {
    await client.query(
      `UPDATE reviewers SET accuracy_score = $2, consecutive_low_accuracy_count = $3 WHERE id = $1`,
      [reviewerId, accuracy, consecutiveFailures],
    );
  }

  it('reports no_data and changes nothing when the reviewer has no gold decisions yet', async () => {
    await withWorld(async ({ client, world, sweep }) => {
      await setAccuracy(client, world.reviewerId, null);

      const result = await sweep.sweepReviewerAccuracy(client, world.reviewerId, new Date());

      expect(result).toEqual({ verdict: 'no_data', consecutiveFailures: 0, requeuedItemIds: [] });
      const reviewer = await client.query<{ status: string }>(
        `SELECT status FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(reviewer.rows[0]?.status).toBe('active');
    });
  });

  it('is ok and resets the streak when accuracy is at or above threshold', async () => {
    await withWorld(async ({ client, world, sweep }) => {
      await setAccuracy(client, world.reviewerId, 0.95, 2);

      const result = await sweep.sweepReviewerAccuracy(client, world.reviewerId, new Date());

      expect(result).toEqual({ verdict: 'ok', consecutiveFailures: 0, requeuedItemIds: [] });
      const reviewer = await client.query<{ status: string; consecutive_low_accuracy_count: number }>(
        `SELECT status, consecutive_low_accuracy_count FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(reviewer.rows[0]).toEqual({ status: 'active', consecutive_low_accuracy_count: 0 });
    });
  });

  it('recalibrates on a first dip below threshold, without touching any items', async () => {
    await withWorld(async ({ client, world, fixtures, sweep }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      await setAccuracy(client, world.reviewerId, 0.5, 0);

      const result = await sweep.sweepReviewerAccuracy(client, world.reviewerId, new Date());

      expect(result).toEqual({ verdict: 'recalibrate', consecutiveFailures: 1, requeuedItemIds: [] });
      const reviewer = await client.query<{ status: string }>(
        `SELECT status FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(reviewer.rows[0]?.status).toBe('calibrating');

      const item = await client.query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [
        itemId,
      ]);
      expect(item.rows[0]?.status).toBe('approved_uncalibrated');
    });
  });

  it('deactivates on sustained failure, requeuing recent approved_uncalibrated approvals via quarantine-then-rework', async () => {
    await withWorld(async ({ client, world, fixtures, sweep }) => {
      const requeueCandidate = await fixtures.insertQueueItem(client, world, {
        status: 'approved_uncalibrated',
      });
      await fixtures.insertDecision(client, requeueCandidate, world.reviewerId, 'approve');

      // Not eligible: already calibrated, so it has real usage data beyond
      // just this reviewer's say-so.
      const alreadyCalibrated = await fixtures.insertQueueItem(client, world, {
        status: 'approved_calibrated',
      });
      await fixtures.insertDecision(client, alreadyCalibrated, world.reviewerId, 'approve');

      // Not eligible: this reviewer rejected it, not approved it.
      const rejectedByThisReviewer = await fixtures.insertQueueItem(client, world, {
        status: 'rejected',
      });
      await fixtures.insertDecision(client, rejectedByThisReviewer, world.reviewerId, 'reject');

      // Not eligible: approved by a different reviewer entirely.
      const othersApproval = await fixtures.insertQueueItem(client, world, {
        status: 'approved_uncalibrated',
      });
      await fixtures.insertDecision(client, othersApproval, world.secondReviewerId, 'approve');

      await setAccuracy(client, world.reviewerId, 0.4, 2);

      const occurredAt = new Date();
      const result = await sweep.sweepReviewerAccuracy(client, world.reviewerId, occurredAt);

      expect(result.verdict).toBe('deactivate');
      expect(result.consecutiveFailures).toBe(3);
      expect(result.requeuedItemIds).toEqual([requeueCandidate]);

      const reviewer = await client.query<{ status: string }>(
        `SELECT status FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(reviewer.rows[0]?.status).toBe('removed');

      const requeuedItem = await client.query<{ status: string }>(
        `SELECT status FROM items WHERE id = $1`,
        [requeueCandidate],
      );
      expect(requeuedItem.rows[0]?.status).toBe('pending_review');

      const untouched = await client.query<{ status: string }>(
        `SELECT status FROM items WHERE id = ANY($1)`,
        [[alreadyCalibrated, rejectedByThisReviewer, othersApproval]],
      );
      expect(untouched.rows.map((r) => r.status).sort()).toEqual(
        ['approved_uncalibrated', 'approved_calibrated', 'rejected'].sort(),
      );

      // The audit trail shows both steps — quarantine, then rework — not a
      // single unexplained jump, and both attributed to the system.
      const transitions = await client.query<{ event: string; to_status: string; actor_role: string }>(
        `SELECT event, to_status, actor_role FROM item_state_transitions
          WHERE item_id = $1 ORDER BY id`,
        [requeueCandidate],
      );
      const sweepTransitions = transitions.rows.slice(-2);
      expect(sweepTransitions).toEqual([
        { event: 'quarantined', to_status: 'quarantined', actor_role: 'system' },
        { event: 'reworked', to_status: 'pending_review', actor_role: 'system' },
      ]);
    });
  });

  it('never claws back earnings for requeued items — the work was done, deactivation is the remedy', async () => {
    await withWorld(async ({ client, world, fixtures, sweep }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        status: 'approved_uncalibrated',
      });
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const decisionId = (
        await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
          itemId,
        ])
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO reviewer_earnings (review_decision_id, reviewer_id, amount_kobo, rate_basis)
         VALUES ($1, $2, 5000, '{}'::jsonb)`,
        [decisionId, world.reviewerId],
      );

      await setAccuracy(client, world.reviewerId, 0.4, 2);
      await sweep.sweepReviewerAccuracy(client, world.reviewerId, new Date());

      const earning = await client.query<{ amount_kobo: string }>(
        `SELECT amount_kobo FROM reviewer_earnings WHERE review_decision_id = $1`,
        [decisionId],
      );
      expect(Number(earning.rows[0]?.amount_kobo)).toBe(5000);
    });
  });

  it('throws when no accuracy threshold config is active', async () => {
    await withWorld(async ({ client, world, sweep }) => {
      await client.query('UPDATE accuracy_threshold_configs SET active = false');
      try {
        await setAccuracy(client, world.reviewerId, 0.5, 0);
        await expect(
          sweep.sweepReviewerAccuracy(client, world.reviewerId, new Date()),
        ).rejects.toThrow(/active/i);
      } finally {
        await client.query('UPDATE accuracy_threshold_configs SET active = true WHERE version = 1');
      }
    });
  });
});
