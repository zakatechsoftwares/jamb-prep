import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('moderator audits', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      audits: typeof import('./moderator-audit-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const audits = await import('./moderator-audit-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, audits });
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

  describe('generateModeratorAuditSample', () => {
    it('samples only from this reviewer’s approvals, never a rejection or another reviewer’s work', async () => {
      await withWorld(async ({ client, world, fixtures, audits }) => {
        const approved = await fixtures.insertQueueItem(client, world);
        await fixtures.insertDecision(client, approved, world.reviewerId, 'approve');

        const rejected = await fixtures.insertQueueItem(client, world);
        await fixtures.insertDecision(client, rejected, world.reviewerId, 'reject');

        const othersApproval = await fixtures.insertQueueItem(client, world);
        await fixtures.insertDecision(client, othersApproval, world.secondReviewerId, 'approve');

        const sample = await audits.generateModeratorAuditSample(
          client,
          world.reviewerId,
          new Date('2000-01-01'),
          10,
        );

        expect(sample.map((s) => s.itemId)).toEqual([approved]);
      });
    });

    it('never samples the same item twice once it has already been audited', async () => {
      await withWorld(async ({ client, world, fixtures, audits }) => {
        const itemId = await fixtures.insertQueueItem(client, world);
        await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');

        const moderator = await fixtures.insertReviewerWithRole(
          client,
          'Audit Moderator',
          '__audit_moderator__',
          'moderator',
        );
        await audits.recordModeratorAudit(client, itemId, moderator.reviewerId, true, null);

        const sample = await audits.generateModeratorAuditSample(
          client,
          world.reviewerId,
          new Date('2000-01-01'),
          10,
        );
        expect(sample).toEqual([]);
      });
    });

    it('respects the since cutoff, excluding older approvals', async () => {
      await withWorld(async ({ client, world, fixtures, audits }) => {
        const itemId = await fixtures.insertQueueItem(client, world);
        await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');

        const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const sample = await audits.generateModeratorAuditSample(
          client,
          world.reviewerId,
          future,
          10,
        );
        expect(sample).toEqual([]);
      });
    });

    it('never returns more than the requested count', async () => {
      await withWorld(async ({ client, world, fixtures, audits }) => {
        for (let i = 0; i < 5; i += 1) {
          const itemId = await fixtures.insertQueueItem(client, world, {
            createdAt: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
          });
          await client.query(
            `INSERT INTO review_decisions (item_id, reviewer_id, action, seconds_taken, idempotency_key)
             VALUES ($1, $2, 'approve', 30, $3)`,
            [itemId, world.reviewerId, `audit-sample-${i}`],
          );
        }

        const sample = await audits.generateModeratorAuditSample(
          client,
          world.reviewerId,
          new Date('2000-01-01'),
          2,
        );
        expect(sample).toHaveLength(2);
      });
    });
  });

  describe('recordModeratorAudit', () => {
    it('records the moderator’s agreement and note', async () => {
      await withWorld(async ({ client, world, fixtures, audits }) => {
        const itemId = await fixtures.insertQueueItem(client, world);
        await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
        const moderator = await fixtures.insertReviewerWithRole(
          client,
          'Audit Moderator 2',
          '__audit_moderator_2__',
          'moderator',
        );

        await audits.recordModeratorAudit(
          client,
          itemId,
          moderator.reviewerId,
          false,
          'distractor B is implausible',
        );

        const row = await client.query<{ agreed: boolean; note: string }>(
          `SELECT agreed, note FROM moderator_audits WHERE item_id = $1`,
          [itemId],
        );
        expect(row.rows[0]).toEqual({ agreed: false, note: 'distractor B is implausible' });
      });
    });
  });
});
