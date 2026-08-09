import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * This is deliberately thin: acceptedItemsPerReviewerHour,
 * rejectionReasonsBySubjectAndWeek, queueDepthBySubject, itemsByState,
 * costPerApprovedItem, interRaterAgreementBySubject, generatePaymentRun and
 * generateModeratorAuditSample/recordModeratorAudit are each already
 * covered by their own repository's integration tests. What isn't covered
 * anywhere else is the wiring in content-lead-service.ts itself — that the
 * composed, pool-managed functions actually connect, delegate, and shape
 * their result correctly — so these tests exercise that composition, not
 * the underlying SQL again.
 */
describe.runIf(hasDatabase)('content-lead-service', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      service: typeof import('./content-lead-service');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const service = await import('./content-lead-service');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, service });
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

  it('getContentLeadDashboard composes every metric into one shaped result', async () => {
    await withWorld(async ({ client, world, fixtures, service }) => {
      const approved = await fixtures.insertQueueItem(client, world, {
        status: 'approved_uncalibrated',
      });
      await fixtures.insertDecision(client, approved, world.reviewerId, 'approve');
      const rejected = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, rejected, world.reviewerId, 'reject');

      const dashboard = await service.getContentLeadDashboard(new Date('2000-01-01'));

      expect(typeof dashboard.acceptedItemsPerReviewerHour).toBe('number');
      expect(dashboard.rejectionReasons.some((r) => r.rejectionReason === 'wrong_key')).toBe(true);
      // `rejected` was inserted directly via review_decisions and never
      // transitioned through the state machine, so it's still sitting in
      // pending_review — exactly like the dashboard repository's own tests.
      expect(dashboard.queueDepth.find((q) => q.subjectId === world.subjectId)?.depth).toBe(1);
      expect(dashboard.itemsByState.some((s) => s.status === 'approved_uncalibrated')).toBe(true);
      expect(dashboard.costPerApprovedItem.approvedCount).toBe(1);
      expect(Array.isArray(dashboard.interRaterAgreement)).toBe(true);
    });
  });

  it('runWeeklyPayment pays out every currently-unpaid earning', async () => {
    await withWorld(async ({ client, world, fixtures, service }) => {
      const approved = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, approved, world.reviewerId, 'approve');
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

      const result = await service.runWeeklyPayment(new Date('2026-01-08'));

      expect(result.batchId).not.toBeNull();
      expect(result.totalKobo).toBe(5000);
      expect(result.lineCount).toBe(1);

      const paid = await client.query<{ paid_at: Date | null }>(
        `SELECT paid_at FROM reviewer_earnings WHERE review_decision_id = $1`,
        [decisionId],
      );
      expect(paid.rows[0]?.paid_at).not.toBeNull();
    });
  });

  it('getAuditSample and recordModeratorAudit round-trip through the moderator flow', async () => {
    await withWorld(async ({ client, world, fixtures, service }) => {
      const approved = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, approved, world.reviewerId, 'approve');
      const moderator = await fixtures.insertReviewerWithRole(
        client,
        'Composed Moderator',
        '__composed_moderator__',
        'moderator',
      );

      const before = await service.getAuditSample(world.reviewerId, new Date('2000-01-01'), 10);
      expect(before.map((s) => s.itemId)).toEqual([approved]);

      await service.recordModeratorAudit(approved, moderator.reviewerId, true, 'looks right');

      const after = await service.getAuditSample(world.reviewerId, new Date('2000-01-01'), 10);
      expect(after).toEqual([]);
    });
  });
});
