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

function draftNeedingDiagram(figureDescription = 'A free-body diagram showing the forces on a block.') {
  return {
    stem: 'A block rests on an incline. Which diagram correctly shows the forces acting on it?',
    explanation: 'Weight acts downward, normal force perpendicular to the incline, friction along it.',
    methodSteps: ['Identify every force.', 'Resolve along and perpendicular to the incline.'],
    cognitiveLevel: 'application',
    authorDifficulty: 0.5,
    expectedTimeSeconds: 90,
    options: OPTIONS,
    diagramRequest: { figureDescription },
  };
}

const SKETCH_PHOTO = { bytes: Buffer.from('fake jpeg bytes'), contentType: 'image/jpeg' };

/**
 * The diagram-request / illustration-ticket / illustrator queue sub-flow
 * (plan 7.12 steps 4-5) — the follow-up to brief-repository.integration.test.ts's
 * text-only coverage. Illustrators are not a new role: `world.reviewerId`
 * doubles as the illustrator in every test here, the same way it doubles as
 * a reviewer, matching the "one pool, no role wall" decision.
 */
describe.runIf(hasDatabase)('illustration-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      briefs: typeof import('./brief-repository');
      illustrations: typeof import('./illustration-repository');
      queue: typeof import('./review-queue-repository');
      decisions: typeof import('./review-decision-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const briefs = await import('./brief-repository');
    const illustrations = await import('./illustration-repository');
    const queue = await import('./review-queue-repository');
    const decisions = await import('./review-decision-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, briefs, illustrations, queue, decisions });
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

  async function claimedBrief(
    client: import('pg').PoolClient,
    world: import('./review-queue.fixtures').QueueWorld,
    fixtures: typeof import('./review-queue.fixtures'),
    briefs: typeof import('./brief-repository'),
  ): Promise<{ briefId: number; contributorReviewerId: number }> {
    const { reviewerId: leadReviewerId } = await fixtures.insertReviewerWithRole(
      client,
      'Lead',
      '__illus_lead__',
      'content_lead',
    );
    const { reviewerId: contributorReviewerId } = await fixtures.insertReviewerWithRole(
      client,
      'Author',
      '__illus_author__',
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
    return { briefId, contributorReviewerId };
  }

  describe('submitContributedItem with a diagram request', () => {
    it('opens an open illustration ticket and leaves the item in generated status, not pending_review', async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);

        const itemId = await briefs.submitContributedItem(
          briefId,
          contributorReviewerId,
          draftNeedingDiagram('A free-body diagram of a block on an incline.'),
          new Date(),
          SKETCH_PHOTO,
        );

        const row = (
          await client.query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [itemId])
        ).rows[0]!;
        expect(row.status).toBe('generated');

        const tickets = await illustrations.listOpenTickets(client);
        const ticket = tickets.find((t) => t.itemId === itemId);
        expect(ticket).toMatchObject({
          itemId,
          status: 'open',
          figureDescription: 'A free-body diagram of a block on an incline.',
          claimedByUserId: null,
        });
      });
    });

    it('throws when diagramRequest is set but no sketchPhoto is provided', async () => {
      await withWorld(async ({ client, world, fixtures, briefs }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);

        await expect(
          briefs.submitContributedItem(briefId, contributorReviewerId, draftNeedingDiagram(), new Date()),
        ).rejects.toThrow(/sketchPhoto/);
      });
    });
  });

  describe('claimTicket', () => {
    it('claims an open ticket for the illustrator', async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);
        const itemId = await briefs.submitContributedItem(
          briefId,
          contributorReviewerId,
          draftNeedingDiagram(),
          new Date(),
          SKETCH_PHOTO,
        );
        const [ticket] = await illustrations.listOpenTickets(client);

        const claimed = await illustrations.claimTicket(ticket!.id, world.reviewerId);
        expect(claimed).toMatchObject({ itemId, status: 'claimed' });
        expect(claimed.claimedByUserId).not.toBeNull();
        expect(claimed.claimedAt).toBeInstanceOf(Date);
      });
    });

    it('throws IllustrationTicketNotClaimableError once already claimed', async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);
        await briefs.submitContributedItem(
          briefId,
          contributorReviewerId,
          draftNeedingDiagram(),
          new Date(),
          SKETCH_PHOTO,
        );
        const [ticket] = await illustrations.listOpenTickets(client);
        await illustrations.claimTicket(ticket!.id, world.reviewerId);

        await expect(
          illustrations.claimTicket(ticket!.id, world.secondReviewerId),
        ).rejects.toThrow(illustrations.IllustrationTicketNotClaimableError);
      });
    });

    it('throws IllustrationTicketNotFoundError for an unknown ticket', async () => {
      await withWorld(async ({ world, illustrations }) => {
        await expect(illustrations.claimTicket(999999, world.reviewerId)).rejects.toThrow(
          illustrations.IllustrationTicketNotFoundError,
        );
      });
    });
  });

  describe('completeTicket', () => {
    async function openAndClaimTicket(
      client: import('pg').PoolClient,
      world: import('./review-queue.fixtures').QueueWorld,
      fixtures: typeof import('./review-queue.fixtures'),
      briefs: typeof import('./brief-repository'),
      illustrations: typeof import('./illustration-repository'),
    ): Promise<{ itemId: number; ticketId: number }> {
      const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);
      const itemId = await briefs.submitContributedItem(
        briefId,
        contributorReviewerId,
        draftNeedingDiagram(),
        new Date(),
        SKETCH_PHOTO,
      );
      const [ticket] = await illustrations.listOpenTickets(client);
      await illustrations.claimTicket(ticket!.id, world.reviewerId);
      return { itemId, ticketId: ticket!.id };
    }

    it('records the SVG and alt text, and promotes the item to pending_review', async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations }) => {
        const { itemId, ticketId } = await openAndClaimTicket(client, world, fixtures, briefs, illustrations);

        await illustrations.completeTicket(
          ticketId,
          world.reviewerId,
          '<svg role="img"><title>incline diagram</title></svg>',
          'A block on an incline with weight, normal and friction forces labelled.',
          new Date(),
        );

        const itemRow = (
          await client.query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [itemId])
        ).rows[0]!;
        expect(itemRow.status).toBe('pending_review');

        const ticketRow = (
          await client.query<{ status: string; svg_asset: string; alt_text: string }>(
            `SELECT status, svg_asset, alt_text FROM illustration_tickets WHERE id = $1`,
            [ticketId],
          )
        ).rows[0]!;
        expect(ticketRow.status).toBe('completed');
        expect(ticketRow.svg_asset).toContain('incline diagram');
        expect(ticketRow.alt_text).toContain('incline');
      });
    });

    it('throws IllustrationTicketNotClaimedByIllustratorError for anyone but the claimant', async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations }) => {
        const { ticketId } = await openAndClaimTicket(client, world, fixtures, briefs, illustrations);

        await expect(
          illustrations.completeTicket(ticketId, world.secondReviewerId, '<svg></svg>', 'alt', new Date()),
        ).rejects.toThrow(illustrations.IllustrationTicketNotClaimedByIllustratorError);
      });
    });
  });

  describe('loadSketchPhoto', () => {
    it('returns the exact bytes and content type the contributor uploaded', async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);
        await briefs.submitContributedItem(
          briefId,
          contributorReviewerId,
          draftNeedingDiagram(),
          new Date(),
          SKETCH_PHOTO,
        );
        const [ticket] = await illustrations.listOpenTickets(client);

        const photo = await illustrations.loadSketchPhoto(ticket!.id);
        expect(photo?.contentType).toBe('image/jpeg');
        expect(Buffer.from(photo!.bytes).equals(SKETCH_PHOTO.bytes)).toBe(true);
      });
    });

    it('returns null for an unknown ticket', async () => {
      await withWorld(async ({ illustrations }) => {
        expect(await illustrations.loadSketchPhoto(999999)).toBeNull();
      });
    });
  });

  it(
    'end to end: created, claimed, authored with a diagram request, illustrated, reviewed and paid',
    async () => {
      await withWorld(async ({ client, world, fixtures, briefs, illustrations, queue, decisions }) => {
        const { briefId, contributorReviewerId } = await claimedBrief(client, world, fixtures, briefs);
        const itemId = await briefs.submitContributedItem(
          briefId,
          contributorReviewerId,
          draftNeedingDiagram(),
          new Date(),
          SKETCH_PHOTO,
        );

        // Not yet servable: still `generated`, waiting on the illustrator.
        expect(await queue.getNextItem(world.reviewerId, { random: neverGold })).toBeNull();

        const [ticket] = await illustrations.listOpenTickets(client);
        await illustrations.claimTicket(ticket!.id, world.reviewerId);
        await illustrations.completeTicket(
          ticket!.id,
          world.reviewerId,
          '<svg role="img"><title>incline diagram</title></svg>',
          'A block on an incline with weight, normal and friction forces labelled.',
          new Date(),
        );

        // Servable now, and carrying the completed diagram — the reviewer
        // must be able to see the figure to review an item about it.
        const [claimed] = await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
        expect(claimed?.itemId).toBe(itemId);
        expect(claimed?.diagram).toMatchObject({
          svgMarkup: '<svg role="img"><title>incline diagram</title></svg>',
          altText: 'A block on an incline with weight, normal and friction forces labelled.',
        });

        // riskTier 'not_generated' always requires a second opinion — same
        // as any high-risk generated item.
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
          await client.query<{ reviewer_id: number; amount_kobo: string }>(
            `SELECT reviewer_id, amount_kobo FROM reviewer_earnings WHERE brief_item_id = $1`,
            [itemId],
          )
        ).rows;
        expect(earnings).toHaveLength(1);
        expect(earnings[0]).toMatchObject({ reviewer_id: contributorReviewerId });
        expect(Number(earnings[0]!.amount_kobo)).toBe(300000);
      });
    },
    20000,
  );
});
