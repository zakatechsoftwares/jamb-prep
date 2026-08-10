import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('content-dashboard-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      dashboard: typeof import('./content-dashboard-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const dashboard = await import('./content-dashboard-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, dashboard });
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

  async function decide(
    client: import('pg').PoolClient,
    itemId: number,
    reviewerId: number,
    action: string,
    secondsTaken: number,
    rejectionReason: string | null = null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO review_decisions (item_id, reviewer_id, action, rejection_reason, seconds_taken, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, reviewerId, action, rejectionReason, secondsTaken, `dash-${itemId}-${reviewerId}-${action}`],
    );
  }

  describe('acceptedItemsPerReviewerHour', () => {
    it('divides accepted decisions by total reviewer-hours across the window', async () => {
      await withWorld(async ({ client, world, fixtures, dashboard }) => {
        const approved = await fixtures.insertQueueItem(client, world);
        await decide(client, approved, world.reviewerId, 'approve', 1800); // 30 min

        const rejected = await fixtures.insertQueueItem(client, world);
        await decide(client, rejected, world.reviewerId, 'reject', 1800, 'wrong_key'); // 30 min

        // 1 accepted / (3600s total / 3600) = 1 accepted item per reviewer-hour.
        const rate = await dashboard.acceptedItemsPerReviewerHour(client, new Date('2000-01-01'));
        expect(rate).toBe(1);
      });
    });

    it('reports 0 rather than dividing by zero when there is no decided time in the window', async () => {
      await withWorld(async ({ client, dashboard }) => {
        const rate = await dashboard.acceptedItemsPerReviewerHour(client, new Date('2000-01-01'));
        expect(rate).toBe(0);
      });
    });
  });

  describe('rejectionReasonsBySubjectAndWeek', () => {
    it('aggregates rejection reasons per subject, making the dominant defect obvious', async () => {
      await withWorld(async ({ client, world, fixtures, dashboard }) => {
        for (let i = 0; i < 3; i += 1) {
          const itemId = await fixtures.insertQueueItem(client, world);
          await decide(client, itemId, world.reviewerId, 'reject', 60, 'implausible_distractor');
        }
        const itemId = await fixtures.insertQueueItem(client, world);
        await decide(client, itemId, world.reviewerId, 'reject', 60, 'off_syllabus');

        const rows = await dashboard.rejectionReasonsBySubjectAndWeek(client, new Date('2000-01-01'));
        const forSubject = rows.filter((r) => r.subjectId === world.subjectId);
        const implausible = forSubject.find((r) => r.rejectionReason === 'implausible_distractor');
        expect(implausible?.count).toBe(3);
        // Sorted so the dominant defect is first, at a glance.
        expect(forSubject[0]?.rejectionReason).toBe('implausible_distractor');
      });
    });

    it('never includes an approval — only rejections carry a reason', async () => {
      await withWorld(async ({ client, world, fixtures, dashboard }) => {
        const itemId = await fixtures.insertQueueItem(client, world);
        await decide(client, itemId, world.reviewerId, 'approve', 60);

        const rows = await dashboard.rejectionReasonsBySubjectAndWeek(client, new Date('2000-01-01'));
        expect(rows).toEqual([]);
      });
    });
  });

  describe('queueDepthBySubject', () => {
    it('counts only the two waiting states, per subject', async () => {
      await withWorld(async ({ client, world, fixtures, dashboard }) => {
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        await fixtures.insertQueueItem(client, world, { status: 'needs_second_review' });
        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });

        const rows = await dashboard.queueDepthBySubject(client);
        const forSubject = rows.find((r) => r.subjectId === world.subjectId);
        expect(forSubject?.depth).toBe(2);
      });
    });
  });

  describe('itemsByState', () => {
    it('counts every item, grouped by its current status', async () => {
      await withWorld(async ({ client, world, fixtures, dashboard }) => {
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        await fixtures.insertQueueItem(client, world, { status: 'rejected' });

        const rows = await dashboard.itemsByState(client);
        const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
        expect(byStatus.pending_review).toBe(2);
        expect(byStatus.rejected).toBe(1);
      });
    });
  });

  describe('costPerApprovedItem', () => {
    it('reports inference cost and reviewer fees separately, never blended (different currencies)', async () => {
      await withWorld(async ({ client, world, fixtures, dashboard }) => {
        const approved = await fixtures.insertQueueItem(client, world, {
          status: 'approved_uncalibrated',
        });
        await client.query('UPDATE items SET inference_cost_usd = 0.02 WHERE id = $1', [approved]);
        await decide(client, approved, world.reviewerId, 'approve', 60);
        const decisionId = (
          await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE item_id = $1`, [
            approved,
          ])
        ).rows[0]!.id;
        await client.query(
          `INSERT INTO reviewer_earnings (review_decision_id, reviewer_id, amount_kobo, rate_basis)
           VALUES ($1, $2, 5000, '{}'::jsonb)`,
          [decisionId, world.reviewerId],
        );

        const notApproved = await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        await client.query('UPDATE items SET inference_cost_usd = 1.00 WHERE id = $1', [notApproved]);

        const result = await dashboard.costPerApprovedItem(client);
        expect(result.approvedCount).toBe(1);
        expect(result.avgInferenceCostUsd).toBeCloseTo(0.02, 4);
        expect(result.avgReviewerFeesKobo).toBeCloseTo(5000, 0);
      });
    });

    it('reports zeros rather than NaN when nothing is approved yet', async () => {
      await withWorld(async ({ client, dashboard }) => {
        const result = await dashboard.costPerApprovedItem(client);
        expect(result).toEqual({ approvedCount: 0, avgInferenceCostUsd: 0, avgReviewerFeesKobo: 0 });
      });
    });
  });
});
