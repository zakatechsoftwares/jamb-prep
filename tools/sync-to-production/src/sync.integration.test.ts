import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syncApprovedItems } from './sync';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * `source` and `target` both point at the same test database here --
 * sufficient to prove `syncApprovedItems`'s own wiring (it only ever
 * takes two `PoolClient`s and never assumes anything about whether
 * they're the same physical database), while natural-key resolution's
 * *correctness* (joining by name, throwing on a miss) already has its
 * own dedicated coverage in `packages/db/src/sync-repository.integration.test.ts`.
 */
describe.runIf(hasDatabase)('syncApprovedItems', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('@jamb/db/fixtures').QueueWorld;
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('@jamb/db');
    const { seedQueueWorld } = await import('@jamb/db/fixtures');
    const client = await pool.connect();

    try {
      const world = await seedQueueWorld(client);
      return await run({ client, world });
    } finally {
      client.release();
    }
  }

  async function truncate(): Promise<void> {
    const { pool } = await import('@jamb/db');
    const { truncateQueueWorld } = await import('@jamb/db/fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
    }
  }

  beforeEach(truncate);
  afterAll(async () => {
    await truncate();
    const { pool } = await import('@jamb/db');
    await pool.end();
  });

  function insertDraft(world: import('@jamb/db/fixtures').QueueWorld, stem: string) {
    return {
      subjectId: world.subjectId,
      topicId: world.topicId,
      subtopicId: world.subtopicId,
      objectiveId: world.objectiveId,
      stem,
      explanation: 'x',
      methodSteps: [],
      cognitiveLevel: 'recall',
      authorDifficulty: 0.3,
      expectedTimeSeconds: 40,
      riskTier: 'low' as const,
      independentSolveVerdict: 'agreed' as const,
      sampledForReview: false,
      stemEmbedding: [0.1, 0.2, 0.3],
      inferenceCostUsd: 0,
      provenance: { model: 'codex-cli' },
      options: [
        { label: 'A' as const, text: 'newton', isCorrect: true, distractorRationale: null },
        { label: 'B' as const, text: 'joule', isCorrect: false, distractorRationale: 'r' },
        { label: 'C' as const, text: 'watt', isCorrect: false, distractorRationale: 'r' },
        { label: 'D' as const, text: 'pascal', isCorrect: false, distractorRationale: 'r' },
      ],
      contributorId: null,
      briefId: null,
    };
  }

  it('syncs an approved local item to a new row with the resolved objective and no reviewer FK', async () => {
    await withWorld(async ({ client, world }) => {
      const { insertGeneratedItem } = await import('@jamb/db');
      const localItemId = await insertGeneratedItem(client, insertDraft(world, 'Sync me.'));
      await client.query(
        `UPDATE items SET status = 'approved_uncalibrated', approval_route = 'auto_gated', reviewer_id = $2, reviewed_at = now() WHERE id = $1`,
        [localItemId, world.reviewerUserId],
      );

      const result = await syncApprovedItems({ source: client, target: client, now: () => new Date('2026-11-15T00:00:00Z') });

      expect(result.syncedLocalItemIds).toEqual([localItemId]);

      const synced = (
        await client.query(
          `SELECT id, stem, status, approval_route, subject_id, reviewer_id, reviewed_at, provenance
             FROM items WHERE external_ref = $1`,
          [`local:${localItemId}`],
        )
      ).rows[0];

      expect(synced.id).not.toBe(localItemId); // a genuinely new row, not an edit of the source
      expect(synced.stem).toBe('Sync me.');
      expect(synced.status).toBe('approved_uncalibrated');
      expect(synced.approval_route).toBe('auto_gated');
      expect(synced.subject_id).toBe(world.subjectId);
      expect(synced.reviewer_id).toBeNull(); // never copied
      expect(synced.reviewed_at).toBeNull();
      expect(synced.provenance.syncedFrom).toMatchObject({
        localItemId,
        localReviewerId: world.reviewerUserId,
        syncedAt: '2026-11-15T00:00:00.000Z',
      });

      const options = (
        await client.query(`SELECT label, is_correct FROM item_options WHERE item_id = $1 ORDER BY label`, [
          synced.id,
        ])
      ).rows;
      expect(options).toHaveLength(4);
    });
  }, 20000);

  it('is idempotent: running twice syncs the same item to the same row, not a duplicate', async () => {
    await withWorld(async ({ client, world }) => {
      const { insertGeneratedItem } = await import('@jamb/db');
      const localItemId = await insertGeneratedItem(client, insertDraft(world, 'Sync me twice.'));
      await client.query(
        `UPDATE items SET status = 'approved_uncalibrated', approval_route = 'auto_gated' WHERE id = $1`,
        [localItemId],
      );

      await syncApprovedItems({ source: client, target: client, now: () => new Date() });
      await syncApprovedItems({ source: client, target: client, now: () => new Date() });

      const rows = await client.query(`SELECT id FROM items WHERE external_ref = $1`, [
        `local:${localItemId}`,
      ]);
      expect(rows.rows).toHaveLength(1);
    });
  }, 20000);

  it('leaves a non-approved local item entirely untouched', async () => {
    await withWorld(async ({ client, world }) => {
      const { insertGeneratedItem } = await import('@jamb/db');
      const localItemId = await insertGeneratedItem(
        client,
        insertDraft(world, 'Still pending, not approved.'),
      );

      const result = await syncApprovedItems({ source: client, target: client, now: () => new Date() });

      expect(result.syncedLocalItemIds).toEqual([]);
      const rows = await client.query(`SELECT id FROM items WHERE external_ref = $1`, [
        `local:${localItemId}`,
      ]);
      expect(rows.rows).toHaveLength(0);
    });
  }, 20000);
});
