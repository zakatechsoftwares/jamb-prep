import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('sync-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      repo: typeof import('./sync-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const repo = await import('./sync-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
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

  function insertDraft(world: import('./review-queue.fixtures').QueueWorld) {
    return {
      subjectId: world.subjectId,
      topicId: world.topicId,
      subtopicId: world.subtopicId,
      objectiveId: world.objectiveId,
      stem: 'What is the SI unit of force?',
      explanation: 'The newton is the SI unit of force.',
      methodSteps: ['Recall F = ma.'],
      cognitiveLevel: 'recall',
      authorDifficulty: 0.3,
      expectedTimeSeconds: 40,
      riskTier: 'low' as const,
      independentSolveVerdict: 'agreed' as const,
      sampledForReview: false,
      stemEmbedding: [0.1, 0.2, 0.3],
      inferenceCostUsd: 0.0123,
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

  describe('loadApprovedItemsForSync', () => {
    it('loads only approved items, with their options and reviewer identity', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const { insertGeneratedItem } = await import('./item-generation-repository');
        const itemId = await insertGeneratedItem(client, insertDraft(world));
        await client.query(
          `UPDATE items SET status = 'approved_uncalibrated', reviewer_id = $2, reviewed_at = now() WHERE id = $1`,
          [itemId, world.reviewerUserId],
        );
        // A non-approved item (stays in its default 'generated' status) must not be selected.
        await insertGeneratedItem(client, {
          ...insertDraft(world),
          stem: 'A pending item, not yet approved.',
        });

        const items = await repo.loadApprovedItemsForSync(client);

        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe(itemId);
        expect(items[0]?.stem).toBe('What is the SI unit of force?');
        expect(items[0]?.reviewerId).toBe(world.reviewerUserId);
        expect(items[0]?.reviewedAt).not.toBeNull();
        expect(items[0]?.options).toHaveLength(4);
        expect(items[0]?.options.find((o) => o.isCorrect)?.text).toBe('newton');
      });
    });
  });

  describe('resolveHierarchyIdsByNaturalKey', () => {
    it('resolves the exact ids for a known subject/topic/subtopic/objective path', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const resolved = await repo.resolveHierarchyIdsByNaturalKey(client, {
          subjectName: 'Physics',
          topicName: 'Mechanics',
          subtopicName: 'Motion',
          objectiveDescription: 'Describe motion',
        });

        expect(resolved).toEqual({
          subjectId: world.subjectId,
          topicId: world.topicId,
          subtopicId: world.subtopicId,
          objectiveId: world.objectiveId,
        });
      });
    });

    it('throws ObjectiveNotFoundByNaturalKeyError, naming the missing path, when nothing matches', async () => {
      await withWorld(async ({ client, repo }) => {
        await expect(
          repo.resolveHierarchyIdsByNaturalKey(client, {
            subjectName: 'Physics',
            topicName: 'Mechanics',
            subtopicName: 'Motion',
            objectiveDescription: 'An objective that does not exist on this database',
          }),
        ).rejects.toMatchObject({
          name: 'ObjectiveNotFoundByNaturalKeyError',
          message: expect.stringContaining('An objective that does not exist on this database'),
        });
      });
    });
  });

  describe('upsertSyncedItem + replaceSyncedItemOptions', () => {
    function upsertInput(world: import('./review-queue.fixtures').QueueWorld, overrides = {}) {
      return {
        localItemId: 999,
        subjectId: world.subjectId,
        topicId: world.topicId,
        subtopicId: world.subtopicId,
        objectiveId: world.objectiveId,
        stem: 'What is the SI unit of force?',
        explanation: 'x',
        methodSteps: [],
        cognitiveLevel: 'recall',
        authorDifficulty: 0.3,
        expectedTimeSeconds: 40,
        riskTier: 'low' as const,
        status: 'approved_uncalibrated',
        approvalRoute: 'auto_gated' as const,
        version: 1,
        provenance: { syncedFrom: { localItemId: 999 } },
        ...overrides,
      };
    }

    it('inserts a new row on first sync, with status/approval_route set from the source', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.upsertSyncedItem(client, upsertInput(world));

        const row = (await client.query(`SELECT * FROM items WHERE id = $1`, [itemId])).rows[0];
        expect(row.status).toBe('approved_uncalibrated');
        expect(row.approval_route).toBe('auto_gated');
        expect(row.external_ref).toBe('local:999');
        expect(row.reviewer_id).toBeNull();
        expect(row.reviewed_at).toBeNull();
      });
    });

    it('is idempotent: re-syncing the same local item updates the same row, not a duplicate', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const firstId = await repo.upsertSyncedItem(client, upsertInput(world));
        const secondId = await repo.upsertSyncedItem(
          client,
          upsertInput(world, { stem: 'An updated stem.', version: 2 }),
        );

        expect(secondId).toBe(firstId);
        const row = (await client.query(`SELECT stem, version FROM items WHERE id = $1`, [firstId]))
          .rows[0];
        expect(row.stem).toBe('An updated stem.');
        expect(row.version).toBe(2);
      });
    });

    it('never overwrites status/approval_route on a re-sync, even when the source still says approved', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.upsertSyncedItem(client, upsertInput(world));

        // The target's own live quality gates moved this item on independently.
        await client.query(`UPDATE items SET status = 'quarantined', approval_route = NULL WHERE id = $1`, [
          itemId,
        ]);

        // A re-sync of the same (still "approved" on the source) item must not undo that.
        await repo.upsertSyncedItem(
          client,
          upsertInput(world, { stem: 'A content-only change.' }),
        );

        const row = (
          await client.query(`SELECT stem, status, approval_route FROM items WHERE id = $1`, [itemId])
        ).rows[0];
        expect(row.stem).toBe('A content-only change.');
        expect(row.status).toBe('quarantined');
        expect(row.approval_route).toBeNull();
      });
    });

    it('fully replaces an item\'s options', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.upsertSyncedItem(client, upsertInput(world));
        await repo.replaceSyncedItemOptions(client, itemId, [
          { label: 'A', text: 'newton', isCorrect: true, distractorRationale: null },
          { label: 'B', text: 'joule', isCorrect: false, distractorRationale: 'r1' },
          { label: 'C', text: 'watt', isCorrect: false, distractorRationale: 'r2' },
          { label: 'D', text: 'pascal', isCorrect: false, distractorRationale: 'r3' },
        ]);

        // A later re-sync with a different key distribution replaces, not appends.
        await repo.replaceSyncedItemOptions(client, itemId, [
          { label: 'A', text: 'newton', isCorrect: false, distractorRationale: 'r1' },
          { label: 'B', text: 'joule', isCorrect: true, distractorRationale: null },
          { label: 'C', text: 'watt', isCorrect: false, distractorRationale: 'r2' },
          { label: 'D', text: 'pascal', isCorrect: false, distractorRationale: 'r3' },
        ]);

        const options = (
          await client.query(`SELECT label, is_correct FROM item_options WHERE item_id = $1 ORDER BY label`, [
            itemId,
          ])
        ).rows;
        expect(options).toHaveLength(4);
        expect(options.find((o: { label: string }) => o.label === 'B').is_correct).toBe(true);
        expect(options.find((o: { label: string }) => o.label === 'A').is_correct).toBe(false);
      });
    });
  });
});
