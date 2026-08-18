import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('brief-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      repo: typeof import('./brief-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const repo = await import('./brief-repository');
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

  async function setTarget(
    client: import('pg').PoolClient,
    objectiveId: number,
    targetItemCount: number | null,
    requiresHumanAuthorship = false,
  ): Promise<void> {
    await client.query(
      `UPDATE objectives SET target_item_count = $2, requires_human_authorship = $3 WHERE id = $1`,
      [objectiveId, targetItemCount, requiresHumanAuthorship],
    );
  }

  function briefInput(
    objectiveId: number,
    overrides: Partial<import('./brief-repository').BriefInsert> = {},
  ): import('./brief-repository').BriefInsert {
    return {
      objectiveId,
      itemCount: 2,
      difficultySpread: { easy: 1, moderate: 1 },
      cognitiveLevels: { recall: 1, application: 1 },
      styleNotes: 'Keep it concise.',
      feeKobo: 500000,
      deadline: new Date('2026-09-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  describe('loadObjectiveCoverage', () => {
    it('excludes objectives with no target set', async () => {
      await withWorld(async ({ client, world, repo }) => {
        const coverage = await repo.loadObjectiveCoverage(client);
        expect(coverage.find((c) => c.objectiveId === world.objectiveId)).toBeUndefined();
      });
    });

    it('counts only approved items toward approvedCount', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await setTarget(client, world.objectiveId, 5, true);
        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        await fixtures.insertQueueItem(client, world, { status: 'approved_calibrated' });
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        await fixtures.insertQueueItem(client, world, { status: 'rejected' });

        const coverage = await repo.loadObjectiveCoverage(client);
        const row = coverage.find((c) => c.objectiveId === world.objectiveId);
        expect(row).toMatchObject({ approvedCount: 2, targetItemCount: 5, requiresHumanAuthorship: true });
      });
    });
  });

  describe('createBrief / listOpenBriefs', () => {
    it('lists a created brief as open', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await setTarget(client, world.objectiveId, 5);
        const { reviewerId: leadReviewerId, userId } = await fixtures.insertReviewerWithRole(
          client,
          'Lead',
          '__lead__',
          'content_lead',
        );

        const briefId = await repo.createBrief(briefInput(world.objectiveId), leadReviewerId);
        const open = await repo.listOpenBriefs(client);

        expect(open.map((b) => b.id)).toContain(briefId);
        const brief = open.find((b) => b.id === briefId)!;
        expect(brief).toMatchObject({
          objectiveId: world.objectiveId,
          itemCount: 2,
          feeKobo: 500000,
          status: 'open',
          createdByUserId: userId,
          claimedByUserId: null,
        });
      });
    });

    it('does not list a claimed or completed brief', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
          client,
          'Lead',
          '__lead2__',
          'content_lead',
        );
        const { reviewerId: contributorReviewerId } = await fixtures.insertReviewerWithRole(
          client,
          'Contributor',
          '__contrib__',
          'contributor',
          [world.subjectId],
        );
        const briefId = await repo.createBrief(briefInput(world.objectiveId), leadReviewerId);

        await repo.claimBrief(briefId, contributorReviewerId);

        const open = await repo.listOpenBriefs(client);
        expect(open.map((b) => b.id)).not.toContain(briefId);
      });
    });
  });

  describe('claimBrief', () => {
    it('claims an open brief for the contributor', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
          client,
          'Lead',
          '__lead3__',
          'content_lead',
        );
        const { reviewerId: contributorReviewerId, userId: contributorUserId } =
          await fixtures.insertReviewerWithRole(client, 'Contributor', '__contrib3__', 'contributor', [
            world.subjectId,
          ]);
        const briefId = await repo.createBrief(briefInput(world.objectiveId), leadReviewerId);

        const claimed = await repo.claimBrief(briefId, contributorReviewerId);

        expect(claimed).toMatchObject({
          id: briefId,
          status: 'claimed',
          claimedByUserId: contributorUserId,
        });
        expect(claimed.claimedAt).toBeInstanceOf(Date);
      });
    });

    it('throws BriefNotFoundError for a brief that does not exist', async () => {
      await withWorld(async ({ client, fixtures, repo }) => {
        const { reviewerId } = await fixtures.insertReviewerWithRole(
          client,
          'Someone',
          '__someone__',
          'contributor',
        );
        await expect(repo.claimBrief(999999, reviewerId)).rejects.toThrow(repo.BriefNotFoundError);
      });
    });

    it('throws BriefNotClaimableError for a brief already claimed', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
          client,
          'Lead',
          '__lead4__',
          'content_lead',
        );
        const { reviewerId: firstContributor } = await fixtures.insertReviewerWithRole(
          client,
          'First',
          '__first__',
          'contributor',
          [world.subjectId],
        );
        const { reviewerId: secondContributor } = await fixtures.insertReviewerWithRole(
          client,
          'Second',
          '__second__',
          'contributor',
          [world.subjectId],
        );
        const briefId = await repo.createBrief(briefInput(world.objectiveId), leadReviewerId);

        await repo.claimBrief(briefId, firstContributor);

        await expect(repo.claimBrief(briefId, secondContributor)).rejects.toThrow(
          repo.BriefNotClaimableError,
        );
      });
    });

    it('exactly one of two simultaneous claims on the same brief succeeds', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
          client,
          'Lead',
          '__lead5__',
          'content_lead',
        );
        const { reviewerId: firstContributor } = await fixtures.insertReviewerWithRole(
          client,
          'FirstC',
          '__firstc__',
          'contributor',
          [world.subjectId],
        );
        const { reviewerId: secondContributor } = await fixtures.insertReviewerWithRole(
          client,
          'SecondC',
          '__secondc__',
          'contributor',
          [world.subjectId],
        );
        const briefId = await repo.createBrief(briefInput(world.objectiveId), leadReviewerId);

        const results = await Promise.allSettled([
          repo.claimBrief(briefId, firstContributor),
          repo.claimBrief(briefId, secondContributor),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
      });
    }, 20000);
  });

  describe('submitContributedItem', () => {
    async function claimedBrief(
      client: import('pg').PoolClient,
      world: import('./review-queue.fixtures').QueueWorld,
      fixtures: typeof import('./review-queue.fixtures'),
      repo: typeof import('./brief-repository'),
      itemCount = 1,
    ): Promise<{ briefId: number; contributorReviewerId: number }> {
      const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
        client,
        'Lead',
        '__lead6__',
        'content_lead',
      );
      const { reviewerId: contributorReviewerId } = await fixtures.insertReviewerWithRole(
        client,
        'Author',
        '__author__',
        'contributor',
        [world.subjectId],
      );
      const briefId = await repo.createBrief(briefInput(world.objectiveId, { itemCount }), leadReviewerId);
      await repo.claimBrief(briefId, contributorReviewerId);
      return { briefId, contributorReviewerId };
    }

    const OPTIONS = [
      { label: 'A' as const, text: 'newton', isCorrect: true, distractorRationale: null },
      { label: 'B' as const, text: 'joule', isCorrect: false, distractorRationale: 'confuses energy' },
      { label: 'C' as const, text: 'watt', isCorrect: false, distractorRationale: 'confuses power' },
      { label: 'D' as const, text: 'pascal', isCorrect: false, distractorRationale: 'confuses pressure' },
    ];

    it('inserts the item with contributor_id and brief_id set, routed to pending_review', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, repo);

        const itemId = await repo.submitContributedItem(
          briefId,
          contributorReviewerId,
          {
            stem: 'What is the SI unit of force?',
            explanation: 'The newton is the SI unit of force.',
            methodSteps: ['Recall F = ma.'],
            cognitiveLevel: 'recall',
            authorDifficulty: 0.3,
            expectedTimeSeconds: 40,
            options: OPTIONS,
            diagramRequest: null,
          },
          new Date('2026-08-17T00:00:00.000Z'),
        );

        const row = (
          await client.query<{
            status: string;
            contributor_id: number;
            brief_id: number;
            risk_tier: string;
          }>(`SELECT status, contributor_id, brief_id, risk_tier FROM items WHERE id = $1`, [itemId])
        ).rows[0]!;

        expect(row).toMatchObject({
          status: 'pending_review',
          brief_id: briefId,
          risk_tier: 'not_generated',
        });
        expect(row.contributor_id).toBeTypeOf('number');
      });
    });

    it('marks the brief completed once submissions reach item_count', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, repo, 2);
        const draft = {
          stem: 'stem',
          explanation: 'explanation',
          methodSteps: [],
          cognitiveLevel: 'recall',
          authorDifficulty: 0.3,
          expectedTimeSeconds: 40,
          options: OPTIONS,
          diagramRequest: null,
        };

        await repo.submitContributedItem(briefId, contributorReviewerId, draft, new Date());
        const open = await repo.listOpenBriefs(client);
        expect(open.map((b) => b.id)).not.toContain(briefId); // already claimed, never listed as open

        await repo.submitContributedItem(briefId, contributorReviewerId, draft, new Date());
        const row = (await client.query<{ status: string }>(`SELECT status FROM briefs WHERE id = $1`, [
          briefId,
        ])).rows[0]!;
        expect(row.status).toBe('completed');
      });
    });

    it('throws BriefNotClaimedByContributorError for a different reviewer than the claimant', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { briefId } = await claimedBrief(client, world, fixtures, repo);
        const { reviewerId: impostor } = await fixtures.insertReviewerWithRole(
          client,
          'Impostor',
          '__impostor__',
          'contributor',
          [world.subjectId],
        );

        await expect(
          repo.submitContributedItem(
            briefId,
            impostor,
            {
              stem: 'stem',
              explanation: 'explanation',
              methodSteps: [],
              cognitiveLevel: 'recall',
              authorDifficulty: 0.3,
              expectedTimeSeconds: 40,
              options: OPTIONS,
              diagramRequest: null,
            },
            new Date(),
          ),
        ).rejects.toThrow(repo.BriefNotClaimedByContributorError);
      });
    });

    it('flows into the ordinary review queue, servable to a different reviewer of the same subject', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const { getNextItem } = await import('./review-queue-repository');
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, repo);

        const itemId = await repo.submitContributedItem(
          briefId,
          contributorReviewerId,
          {
            stem: 'What is the SI unit of force?',
            explanation: 'explanation',
            methodSteps: [],
            cognitiveLevel: 'recall',
            authorDifficulty: 0.3,
            expectedTimeSeconds: 40,
            options: OPTIONS,
            diagramRequest: null,
          },
          new Date(),
        );

        const served = await getNextItem(world.reviewerId);
        expect(served?.itemId).toBe(itemId);
      });
    });
  });
});
