import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('item-generation-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      repo: typeof import('./item-generation-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const repo = await import('./item-generation-repository');
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
      provenance: { model: 'claude-sonnet-5', promptVersion: 1 },
      options: [
        { label: 'A' as const, text: 'newton', isCorrect: true, distractorRationale: null },
        {
          label: 'B' as const,
          text: 'joule',
          isCorrect: false,
          distractorRationale: 'confuses force with energy',
        },
        {
          label: 'C' as const,
          text: 'watt',
          isCorrect: false,
          distractorRationale: 'confuses force with power',
        },
        {
          label: 'D' as const,
          text: 'pascal',
          isCorrect: false,
          distractorRationale: 'confuses force with pressure',
        },
      ],
    };
  }

  describe('loadObjectiveContext', () => {
    it('returns the full subject/topic/subtopic/objective chain for a real objective', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const context = await repo.loadObjectiveContext(client, world.objectiveId);
        expect(context).toMatchObject({
          objectiveId: world.objectiveId,
          subtopicId: world.subtopicId,
          topicId: world.topicId,
          subjectId: world.subjectId,
          subjectName: 'Physics',
        });
        expect(context.objectiveDescription.length).toBeGreaterThan(0);
      });
    });

    it('throws for a nonexistent objective id', async () => {
      await withWorld(async ({ client, repo }) => {
        await expect(repo.loadObjectiveContext(client, 999_999_999)).rejects.toThrow(/objective/i);
      });
    });
  });

  describe('insertGeneratedItem', () => {
    it('inserts the item as generated with its four options and embedding/cost recorded', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.insertGeneratedItem(client, insertDraft(world));

        const item = await client.query<{
          status: string;
          stem_embedding: number[] | null;
          inference_cost_usd: string;
        }>(`SELECT status, stem_embedding, inference_cost_usd FROM items WHERE id = $1`, [itemId]);
        expect(item.rows[0]?.status).toBe('generated');
        expect(item.rows[0]?.stem_embedding).toEqual([0.1, 0.2, 0.3]);
        expect(Number(item.rows[0]?.inference_cost_usd)).toBeCloseTo(0.0123, 4);

        const options = await client.query<{
          label: string;
          option_text: string;
          is_correct: boolean;
          distractor_rationale: string | null;
        }>(
          `SELECT label, option_text, is_correct, distractor_rationale FROM item_options WHERE item_id = $1 ORDER BY label`,
          [itemId],
        );
        expect(options.rows).toEqual([
          { label: 'A', option_text: 'newton', is_correct: true, distractor_rationale: null },
          {
            label: 'B',
            option_text: 'joule',
            is_correct: false,
            distractor_rationale: 'confuses force with energy',
          },
          {
            label: 'C',
            option_text: 'watt',
            is_correct: false,
            distractor_rationale: 'confuses force with power',
          },
          {
            label: 'D',
            option_text: 'pascal',
            is_correct: false,
            distractor_rationale: 'confuses force with pressure',
          },
        ]);
      });
    });
  });

  describe('loadLiveBankEmbeddings', () => {
    it('returns embeddings for non-terminal items in the subject, excluding rejected/retired and null embeddings', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const withEmbedding = await repo.insertGeneratedItem(client, insertDraft(world));

        const rejected = await repo.insertGeneratedItem(client, {
          ...insertDraft(world),
          stemEmbedding: [0.4, 0.5, 0.6],
        });
        await client.query(`UPDATE items SET status = 'rejected' WHERE id = $1`, [rejected]);

        const noEmbedding = await fixtures.insertQueueItem(client, world);

        const candidates = await repo.loadLiveBankEmbeddings(client, world.subjectId);
        const itemIds = candidates.map((c) => c.itemId);
        expect(itemIds).toContain(withEmbedding);
        expect(itemIds).not.toContain(rejected);
        expect(itemIds).not.toContain(noEmbedding);

        const found = candidates.find((c) => c.itemId === withEmbedding);
        expect(found?.stemEmbedding).toEqual([0.1, 0.2, 0.3]);
      });
    });
  });

  describe('promoteGeneratedItem', () => {
    const itemFacts = {
      contributorUserId: null,
      riskTier: 'low' as const,
      independentSolveVerdict: 'agreed' as const,
      sampledForReview: false,
    };

    it('gates_failed moves the item to gate_failed and records the transition', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.insertGeneratedItem(client, insertDraft(world));

        const result = await repo.promoteGeneratedItem(
          client,
          itemId,
          itemFacts,
          { type: 'gates_failed' },
          new Date(),
        );
        expect(result.status).toBe('gate_failed');

        const row = await client.query<{ status: string }>(
          `SELECT status FROM items WHERE id = $1`,
          [itemId],
        );
        expect(row.rows[0]?.status).toBe('gate_failed');

        const transitionRow = await client.query<{ event: string; actor_role: string }>(
          `SELECT event, actor_role FROM item_state_transitions WHERE item_id = $1`,
          [itemId],
        );
        expect(transitionRow.rows[0]).toEqual({ event: 'gates_failed', actor_role: 'system' });
      });
    });

    it('gates_passed moves the item to pending_review', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.insertGeneratedItem(client, insertDraft(world));
        const result = await repo.promoteGeneratedItem(
          client,
          itemId,
          itemFacts,
          { type: 'gates_passed' },
          new Date(),
        );
        expect(result.status).toBe('pending_review');
      });
    });

    it('auto_gate_promote moves a qualifying item to approved_uncalibrated with approval_route auto_gated', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.insertGeneratedItem(client, insertDraft(world));
        const result = await repo.promoteGeneratedItem(
          client,
          itemId,
          itemFacts,
          { type: 'auto_gate_promote' },
          new Date(),
        );
        expect(result).toMatchObject({
          status: 'approved_uncalibrated',
          approvalRoute: 'auto_gated',
        });

        const row = await client.query<{ status: string; approval_route: string }>(
          `SELECT status, approval_route FROM items WHERE id = $1`,
          [itemId],
        );
        expect(row.rows[0]).toEqual({
          status: 'approved_uncalibrated',
          approval_route: 'auto_gated',
        });
      });
    });

    it('auto_gate_promote throws for an item that does not qualify (defense in depth)', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const itemId = await repo.insertGeneratedItem(client, {
          ...insertDraft(world),
          riskTier: 'high',
        });
        await expect(
          repo.promoteGeneratedItem(
            client,
            itemId,
            { ...itemFacts, riskTier: 'high' },
            { type: 'auto_gate_promote' },
            new Date(),
          ),
        ).rejects.toThrow(/7\.14|automated route/i);
      });
    });
  });
});
