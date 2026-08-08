import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Reuses the queue's fixtures and the queue's own claiming path
// (getNextItemBatch) to set items up as claimed — that is the only way an
// item legitimately becomes claimed, so exercising the real code path is
// both less fixture code and a better guarantee than hand-rolling one.
process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const neverGold = () => 0.999999;

describe.runIf(hasDatabase)('review decision endpoints', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      queue: typeof import('./review-queue-repository');
      decisions: typeof import('./review-decision-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const queue = await import('./review-queue-repository');
    const decisions = await import('./review-decision-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, queue, decisions });
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

  // -------------------------------------------------------------------------
  // The anti-anchoring gate itself
  // -------------------------------------------------------------------------

  it('withholds the key for a high risk_tier item until the reviewer has solved it', async () => {
    await withWorld(async ({ client, world, fixtures, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });
      const [claimed] = await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      expect(claimed?.itemId).toBe(itemId);

      const beforeSolve = await decisions.revealItem(world.reviewerId, itemId);
      expect(beforeSolve).toEqual({ ok: false, reason: 'not_yet_solved' });

      const solved = await decisions.submitBlindAnswer(world.reviewerId, itemId, 'B');
      expect(solved).toEqual({ ok: true, itemId, answer: 'B' });

      const afterSolve = await decisions.revealItem(world.reviewerId, itemId);
      expect(afterSolve).toMatchObject({
        ok: true,
        correctOption: 'A',
        agreesWithKey: false,
      });
    });
  });

  it('reveals a low risk_tier item immediately, without requiring a blind answer', async () => {
    await withWorld(async ({ client, world, fixtures, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const revealed = await decisions.revealItem(world.reviewerId, itemId);
      expect(revealed).toMatchObject({ ok: true, correctOption: 'A', agreesWithKey: null });
    });
  });

  it('never reveals to a reviewer who does not currently hold the item', async () => {
    await withWorld(async ({ client, world, fixtures, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      // Nobody has claimed it.
      expect(await decisions.revealItem(world.reviewerId, itemId)).toEqual({
        ok: false,
        reason: 'not_claimed_by_you',
      });
    });
  });

  // -------------------------------------------------------------------------
  // The reclaim path — expired claim, new reviewer, no leaked answer
  // -------------------------------------------------------------------------

  it('gives a reviewer who inherits an expired claim no access to the previous reviewer’s answer', async () => {
    // The real, reachable reclaim path: releaseExpiredClaims resets the
    // item's status and deletes the stale review_claims row in the same
    // step, so the next claim is a fresh INSERT — which starts with
    // reviewer_answer NULL by construction. This is the path a reviewer
    // actually takes when polling for work after someone else's claim
    // lapsed.
    await withWorld(async ({ client, world, fixtures, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });

      const [claimedByFirst] = await queue.getNextItemBatch(world.reviewerId, 1, {
        random: neverGold,
      });
      expect(claimedByFirst?.itemId).toBe(itemId);

      const solved = await decisions.submitBlindAnswer(world.reviewerId, itemId, 'C');
      expect(solved.ok).toBe(true);

      await client.query(
        `UPDATE review_claims
            SET claimed_at = now() - interval '2 hours',
                expires_at = now() - interval '1 minute'
          WHERE item_id = $1`,
        [itemId],
      );
      expect(await queue.releaseExpiredClaims()).toBe(1);

      const [claimedBySecond] = await queue.getNextItemBatch(world.secondReviewerId, 1, {
        random: neverGold,
      });
      expect(claimedBySecond?.itemId).toBe(itemId);

      const revealForSecond = await decisions.revealItem(world.secondReviewerId, itemId);
      expect(revealForSecond).toEqual({ ok: false, reason: 'not_yet_solved' });

      const answerRow = await client.query<{ reviewer_answer: string | null; reviewer_id: number }>(
        `SELECT reviewer_answer, reviewer_id FROM review_claims WHERE item_id = $1`,
        [itemId],
      );
      expect(answerRow.rows[0]?.reviewer_answer).toBeNull();
      expect(answerRow.rows[0]?.reviewer_id).toBe(world.secondReviewerId);
    });
  });

  it('resets reviewer_answer on the ON CONFLICT reclaim path, even though that branch is not reachable today', async () => {
    // items.status gates candidacy to pending_review/needs_second_review
    // (lockCandidates' WHERE clause), and the only code path that returns
    // status to one of those two values after an expiry — releaseExpiredClaims
    // — also deletes the review_claims row in that same step. So by the
    // time an item is candidate-eligible again, no conflicting row remains,
    // and claimItems' INSERT ... ON CONFLICT DO UPDATE branch never actually
    // fires through the application today.
    //
    // The reset is kept anyway, as defense in depth against a future change
    // that makes this branch reachable (a different status gate, a
    // releaseExpiredClaims that stops deleting the row) — and is tested
    // directly here, against a hand-constructed state that recreates
    // exactly the row conflict claimItems' INSERT would face, the same way
    // a CHECK constraint is tested directly rather than only through the
    // application code that happens to respect it today.
    await withWorld(async ({ client, world, fixtures }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });

      await client.query(
        `INSERT INTO review_claims (item_id, reviewer_id, claimed_at, expires_at, reviewer_answer)
         VALUES ($1, $2, now() - interval '2 hours', now() - interval '1 minute', 'C')`,
        [itemId, world.reviewerId],
      );

      await client.query(
        `INSERT INTO review_claims (item_id, reviewer_id, claimed_at, expires_at)
         VALUES ($1, $2, now(), now() + interval '30 minutes')
         ON CONFLICT (item_id) DO UPDATE
            SET reviewer_id = EXCLUDED.reviewer_id,
                claimed_at = EXCLUDED.claimed_at,
                expires_at = EXCLUDED.expires_at,
                reviewer_answer = NULL
          WHERE review_claims.expires_at <= now()`,
        [itemId, world.secondReviewerId],
      );

      const row = await client.query<{ reviewer_answer: string | null; reviewer_id: number }>(
        `SELECT reviewer_answer, reviewer_id FROM review_claims WHERE item_id = $1`,
        [itemId],
      );
      expect(row.rows[0]).toEqual({ reviewer_answer: null, reviewer_id: world.secondReviewerId });
    });
  });

  // -------------------------------------------------------------------------
  // Immutability — a blind answer cannot be rewritten
  // -------------------------------------------------------------------------

  it('refuses to overwrite a blind answer already recorded for the same claim', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const first = await decisions.submitBlindAnswer(world.reviewerId, itemId, 'A');
      expect(first).toEqual({ ok: true, itemId, answer: 'A' });

      // Reveal, then attempt to rewrite the answer to match the key —
      // exactly the move the immutability rule exists to prevent.
      await decisions.revealItem(world.reviewerId, itemId);
      const second = await decisions.submitBlindAnswer(world.reviewerId, itemId, 'A');
      expect(second).toEqual({ ok: false, reason: 'already_answered' });

      const stored = await client.query<{ reviewer_answer: string | null }>(
        `SELECT reviewer_answer FROM review_claims WHERE item_id = $1`,
        [itemId],
      );
      expect(stored.rows[0]?.reviewer_answer).toBe('A');
    });
  });

  it('rejects a direct SQL rewrite of an already-recorded answer within the same claim episode', async () => {
    // Defense in depth: the database itself refuses this, not only the
    // application's guarded UPDATE. Mirrors the append-only guard tests
    // for review_decisions and item_state_transitions.
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      await decisions.submitBlindAnswer(world.reviewerId, itemId, 'A');

      await expect(
        client.query(`UPDATE review_claims SET reviewer_answer = 'B' WHERE item_id = $1`, [itemId]),
      ).rejects.toThrow(/immutable/);
    });
  });

  // -------------------------------------------------------------------------
  // The four actions, each driving the correct transition
  // -------------------------------------------------------------------------

  it('approve on a low-risk item reaches approved_uncalibrated with the human_reviewed route', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });

      expect(result).toEqual({
        ok: true,
        itemId,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
      });

      const row = await client.query<{ status: string; approval_route: string }>(
        `SELECT status, approval_route FROM items WHERE id = $1`,
        [itemId],
      );
      expect(row.rows[0]).toEqual({
        status: 'approved_uncalibrated',
        approval_route: 'human_reviewed',
      });

      // The bug found while implementing this session: item_state_transitions
      // never populated approval_route before decideOnItem existed to
      // produce a non-null one.
      const transitionRow = await client.query<{ approval_route: string }>(
        `SELECT approval_route FROM item_state_transitions
          WHERE item_id = $1 AND event = 'reviewer_decided'`,
        [itemId],
      );
      expect(transitionRow.rows[0]?.approval_route).toBe('human_reviewed');

      // The claim is gone: the item left in_review.
      const claim = await client.query('SELECT 1 FROM review_claims WHERE item_id = $1', [itemId]);
      expect(claim.rowCount).toBe(0);
    });
  });

  it('reject records the structured reason and reaches rejected', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'reject',
        rejectionReason: 'ambiguous_stem',
        edits: null,
      });

      expect(result).toEqual({ ok: true, itemId, status: 'rejected', approvalRoute: null });

      const decisionRow = await client.query<{ rejection_reason: string }>(
        `SELECT rejection_reason FROM review_decisions WHERE item_id = $1`,
        [itemId],
      );
      expect(decisionRow.rows[0]?.rejection_reason).toBe('ambiguous_stem');
    });
  });

  it('escalate reaches escalated', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'escalate',
        rejectionReason: null,
        edits: null,
      });

      expect(result).toEqual({ ok: true, itemId, status: 'escalated', approvalRoute: null });
    });
  });

  it('edit_and_approve applies the patch, records the diff, and approves', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'edit_and_approve',
        rejectionReason: null,
        edits: { stem: 'Corrected stem text', options: { B: 'revised distractor' }, key: 'B' },
      });

      expect(result).toMatchObject({ ok: true, itemId, status: 'approved_uncalibrated' });

      const item = await client.query<{ stem: string }>('SELECT stem FROM items WHERE id = $1', [
        itemId,
      ]);
      expect(item.rows[0]?.stem).toBe('Corrected stem text');

      const options = await client.query<{
        label: string;
        option_text: string;
        is_correct: boolean;
      }>(
        `SELECT label, option_text, is_correct FROM item_options WHERE item_id = $1 ORDER BY label`,
        [itemId],
      );
      const byLabel = Object.fromEntries(
        options.rows.map((row) => [row.label, { text: row.option_text, correct: row.is_correct }]),
      );
      expect(byLabel.B).toEqual({ text: 'revised distractor', correct: true });
      expect(byLabel.A?.correct).toBe(false);

      const decisionRow = await client.query<{ edit_diff: unknown }>(
        `SELECT edit_diff FROM review_decisions WHERE item_id = $1`,
        [itemId],
      );
      expect(decisionRow.rows[0]?.edit_diff).toMatchObject({
        stem: { after: 'Corrected stem text' },
        key: { before: 'A', after: 'B' },
        options: { B: { after: 'revised distractor' } },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Ownership
  // -------------------------------------------------------------------------

  it('refuses to decide on an item the reviewer does not currently hold', async () => {
    await withWorld(async ({ world, fixtures, client, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });

      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });

      expect(result).toEqual({ ok: false, reason: 'not_claimed_by_you' });
    });
  });

  // -------------------------------------------------------------------------
  // End to end: solve, reveal, decide, second review
  // -------------------------------------------------------------------------

  it('drives a high-risk item through solve, reveal and a second review to approval', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });

      // First reviewer: blind, then reveals, then approves — but a single
      // approval on a high risk_tier item cannot reach the bank alone.
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      await decisions.submitBlindAnswer(world.reviewerId, itemId, 'A');
      const revealed = await decisions.revealItem(world.reviewerId, itemId);
      expect(revealed).toMatchObject({ correctOption: 'A', agreesWithKey: true });

      const firstDecision = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(firstDecision).toEqual({
        ok: true,
        itemId,
        status: 'needs_second_review',
        approvalRoute: null,
      });

      // Second, independent reviewer picks it up from needs_second_review.
      const [claimedBySecond] = await queue.getNextItemBatch(world.secondReviewerId, 1, {
        random: neverGold,
      });
      expect(claimedBySecond?.itemId).toBe(itemId);

      const secondDecision = await decisions.decideOnItem(world.secondReviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(secondDecision).toEqual({
        ok: true,
        itemId,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
      });

      const decisionCount = await client.query(
        'SELECT count(*) FROM review_decisions WHERE item_id = $1',
        [itemId],
      );
      expect(Number(decisionCount.rows[0]?.count)).toBe(2);
    });
  });
});
