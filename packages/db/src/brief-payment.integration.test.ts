import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const neverGold = () => 0.999999;

const OPTIONS = [
  { label: 'A' as const, text: 'newton', isCorrect: true, distractorRationale: null },
  { label: 'B' as const, text: 'joule', isCorrect: false, distractorRationale: 'confuses energy' },
  { label: 'C' as const, text: 'watt', isCorrect: false, distractorRationale: 'confuses power' },
  { label: 'D' as const, text: 'pascal', isCorrect: false, distractorRationale: 'confuses pressure' },
];

const DRAFT = {
  stem: 'What is the SI unit of force?',
  explanation: 'The newton is the SI unit of force.',
  methodSteps: ['Recall F = ma.'],
  cognitiveLevel: 'recall',
  authorDifficulty: 0.3,
  expectedTimeSeconds: 40,
  options: OPTIONS,
};

/**
 * The contributor-fee path (plan 7.12 step 7): fires from decideOnItem, in
 * the same transaction as the reviewer's own earnings, when a brief-linked
 * item lands in an approved status. Exercised end to end here rather than
 * only at brief-repository.ts's own layer, since the fee-recording call
 * itself lives in review-decision-repository.ts.
 */
describe.runIf(hasDatabase)('contributor fee on approval', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      briefs: typeof import('./brief-repository');
      queue: typeof import('./review-queue-repository');
      decisions: typeof import('./review-decision-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const briefs = await import('./brief-repository');
    const queue = await import('./review-queue-repository');
    const decisions = await import('./review-decision-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, briefs, queue, decisions });
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

  it('records a reviewer_earnings row for the contributor, keyed to the item, on approval', async () => {
    await withWorld(async ({ client, world, fixtures, briefs, queue, decisions }) => {
      const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
        client,
        'Lead',
        '__lead_pay__',
        'content_lead',
      );
      const { reviewerId: contributorReviewerId } = await fixtures.insertReviewerWithRole(
        client,
        'Author',
        '__author_pay__',
        'contributor',
        [world.subjectId],
      );

      const briefId = await briefs.createBrief(
        {
          objectiveId: world.objectiveId,
          itemCount: 1,
          difficultySpread: {},
          cognitiveLevels: {},
          styleNotes: null,
          feeKobo: 300000,
          deadline: new Date('2026-09-01T00:00:00.000Z'),
        },
        leadReviewerId,
      );
      await briefs.claimBrief(briefId, contributorReviewerId);
      const itemId = await briefs.submitContributedItem(
        briefId,
        contributorReviewerId,
        DRAFT,
        new Date(),
      );

      // The contributor is not eligible to review their own item. A
      // contributed item's risk_tier ('not_generated') also always
      // satisfies transition()'s requiresSecondOpinion check (riskTier
      // !== 'low'), so — like a high-risk generated item — it needs two
      // independent reviewers before it can be approved, not one.
      const [claimed] = await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      expect(claimed?.itemId).toBe(itemId);
      const firstOutcome = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(firstOutcome).toMatchObject({ ok: true, status: 'needs_second_review' });

      const [claimedAgain] = await queue.getNextItemBatch(world.secondReviewerId, 1, {
        random: neverGold,
      });
      expect(claimedAgain?.itemId).toBe(itemId);
      const outcome = await decisions.decideOnItem(world.secondReviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(outcome).toMatchObject({ ok: true, status: 'approved_uncalibrated' });

      const earnings = (
        await client.query<{ reviewer_id: number; amount_kobo: string; review_decision_id: number | null }>(
          `SELECT reviewer_id, amount_kobo, review_decision_id FROM reviewer_earnings WHERE brief_item_id = $1`,
          [itemId],
        )
      ).rows;

      expect(earnings).toHaveLength(1);
      expect(earnings[0]).toMatchObject({
        reviewer_id: contributorReviewerId,
        review_decision_id: null,
      });
      expect(Number(earnings[0]!.amount_kobo)).toBe(300000);
    });
  });

  it('conserves the full fee exactly across a multi-item brief with an uneven split', async () => {
    await withWorld(async ({ client, world, fixtures, briefs, queue, decisions }) => {
      const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
        client,
        'Lead',
        '__lead_pay2__',
        'content_lead',
      );
      const { reviewerId: contributorReviewerId } = await fixtures.insertReviewerWithRole(
        client,
        'Author2',
        '__author_pay2__',
        'contributor',
        [world.subjectId],
      );

      const briefId = await briefs.createBrief(
        {
          objectiveId: world.objectiveId,
          itemCount: 3,
          difficultySpread: {},
          cognitiveLevels: {},
          styleNotes: null,
          feeKobo: 1000, // does not divide evenly by 3
          deadline: new Date('2026-09-01T00:00:00.000Z'),
        },
        leadReviewerId,
      );
      await briefs.claimBrief(briefId, contributorReviewerId);

      for (let i = 0; i < 3; i += 1) {
        await briefs.submitContributedItem(briefId, contributorReviewerId, DRAFT, new Date());
      }

      // Order doesn't matter for this test (fee conservation, not queue
      // ordering) — claim and decide whichever three items come back. Each
      // needs two independent decisions (riskTier 'not_generated' always
      // requires a second opinion) before it reaches an approved status.
      for (let i = 0; i < 3; i += 1) {
        const [claimed] = await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
        await decisions.decideOnItem(world.reviewerId, claimed!.itemId, {
          action: 'approve',
          rejectionReason: null,
          edits: null,
        });
        const [claimedAgain] = await queue.getNextItemBatch(world.secondReviewerId, 1, {
          random: neverGold,
        });
        await decisions.decideOnItem(world.secondReviewerId, claimedAgain!.itemId, {
          action: 'approve',
          rejectionReason: null,
          edits: null,
        });
      }

      const totalResult = await client.query<{ total: string }>(
        `SELECT COALESCE(sum(re.amount_kobo), 0) AS total
           FROM reviewer_earnings re
           JOIN items i ON i.id = re.brief_item_id
          WHERE i.brief_id = $1`,
        [briefId],
      );
      expect(Number(totalResult.rows[0]!.total)).toBe(1000);
    });
  }, 20000);
});
