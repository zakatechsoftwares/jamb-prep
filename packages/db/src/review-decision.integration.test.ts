import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// Reuses the queue's fixtures and the queue's own claiming path
// (getNextItemBatch) to set items up as claimed — that is the only way an
// item legitimately becomes claimed, so exercising the real code path is
// both less fixture code and a better guarantee than hand-rolling one.
process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const neverGold = () => 0.999999;
const alwaysGold = () => 0;

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
        decisionContext: 'live',
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

      expect(result).toEqual({
        ok: true,
        itemId,
        status: 'rejected',
        approvalRoute: null,
        decisionContext: 'live',
      });

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

      expect(result).toEqual({
        ok: true,
        itemId,
        status: 'escalated',
        approvalRoute: null,
        decisionContext: 'live',
      });
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
        decisionContext: 'live',
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
        decisionContext: 'live',
      });

      const decisionCount = await client.query(
        'SELECT count(*) FROM review_decisions WHERE item_id = $1',
        [itemId],
      );
      expect(Number(decisionCount.rows[0]?.count)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // The offline workspace (session 08): a claim expires while the reviewer
  // is offline, and their decision arrives after the item has already moved
  // on. Never discarded, never overwrites the authoritative outcome.
  // -------------------------------------------------------------------------

  it('records a late-arriving decision as an audit-only second opinion, without touching the item’s current state', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });

      // First reviewer claims it, then goes offline — their claim expires
      // with no decision ever reaching the server.
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      await client.query(
        `UPDATE review_claims SET claimed_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE item_id = $1`,
        [itemId],
      );
      expect(await queue.releaseExpiredClaims()).toBe(1);

      // A second, independent reviewer claims and decides while the first
      // is still offline — this is the authoritative decision.
      await queue.getNextItemBatch(world.secondReviewerId, 1, { random: neverGold });
      const authoritative = await decisions.decideOnItem(world.secondReviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(authoritative).toEqual({
        ok: true,
        itemId,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'live',
      });

      // The first reviewer reconnects and syncs the decision they made
      // offline, against a claim that no longer exists.
      const lateArrival = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'reject',
        rejectionReason: 'wrong_key',
        edits: null,
        idempotencyKey: 'offline-decision-1',
      });

      expect(lateArrival).toEqual({
        ok: true,
        itemId,
        // The item's current, unchanged status/route — not driven by this
        // decision, just reported back so the client can display it.
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'late_arrival',
      });

      // The item itself never moved because of the late decision.
      const item = await client.query<{ status: string; approval_route: string }>(
        `SELECT status, approval_route FROM items WHERE id = $1`,
        [itemId],
      );
      expect(item.rows[0]).toEqual({
        status: 'approved_uncalibrated',
        approval_route: 'human_reviewed',
      });

      // Both decisions are on the record — the second reviewer's live
      // approval was never overwritten.
      const rows = await client.query<{
        reviewer_id: number;
        action: string;
        decision_context: string;
      }>(
        `SELECT reviewer_id, action, decision_context FROM review_decisions
          WHERE item_id = $1 ORDER BY created_at`,
        [itemId],
      );
      expect(rows.rows).toEqual([
        { reviewer_id: world.secondReviewerId, action: 'approve', decision_context: 'live' },
        { reviewer_id: world.reviewerId, action: 'reject', decision_context: 'late_arrival' },
      ]);
    });
  });

  it('still refuses a decision from a reviewer who never held the item at all', async () => {
    await withWorld(async ({ world, fixtures, client, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      // Nobody has ever claimed it, so there is no legitimate late arrival.
      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(result).toEqual({ ok: false, reason: 'not_claimed_by_you' });
    });
  });

  it('uploading the same decision three times produces exactly one row', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });

      const input = {
        action: 'approve' as const,
        rejectionReason: null,
        edits: null,
        idempotencyKey: 'retry-key-1',
      };

      const first = await decisions.decideOnItem(world.reviewerId, itemId, input);
      const second = await decisions.decideOnItem(world.reviewerId, itemId, input);
      const third = await decisions.decideOnItem(world.reviewerId, itemId, input);

      expect(first).toEqual(second);
      expect(second).toEqual(third);
      expect(first).toEqual({
        ok: true,
        itemId,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'live',
      });

      const count = await client.query('SELECT count(*) FROM review_decisions WHERE item_id = $1', [
        itemId,
      ]);
      expect(Number(count.rows[0]?.count)).toBe(1);
    });
  });

  it('a retried late-arrival decision also produces exactly one audit row', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      await client.query(
        `UPDATE review_claims SET claimed_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE item_id = $1`,
        [itemId],
      );
      await queue.releaseExpiredClaims();
      await queue.getNextItemBatch(world.secondReviewerId, 1, { random: neverGold });
      await decisions.decideOnItem(world.secondReviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });

      const input = {
        action: 'reject' as const,
        rejectionReason: 'wrong_key' as const,
        edits: null,
        idempotencyKey: 'offline-decision-retry-1',
      };

      const first = await decisions.decideOnItem(world.reviewerId, itemId, input);
      const second = await decisions.decideOnItem(world.reviewerId, itemId, input);

      expect(first).toEqual(second);
      expect(first).toMatchObject({ ok: true, decisionContext: 'late_arrival' });

      const count = await client.query(
        `SELECT count(*) FROM review_decisions WHERE item_id = $1 AND reviewer_id = $2`,
        [itemId, world.reviewerId],
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Gold scoring and earnings wiring (session 09) — a column existing is not
  // a column being written: this proves decideOnItem itself populates
  // gold_item_scores and reviewer_earnings, not just that the standalone
  // repository functions work when called directly.
  // -------------------------------------------------------------------------

  it('decideOnItem records a gold-item score and an earning for an ordinary live decision', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, {
        riskTier: 'low',
        gold: { referenceDecision: 'approve', referenceKey: 'A', plantedErrorType: null },
      });
      // The gold draw is a random gate on top of a gold_items row existing —
      // getNextItemBatch excludes gold items entirely when not specifically
      // drawing one, so this item is only servable via a forced draw.
      await queue.getNextItemBatch(world.reviewerId, 1, { random: alwaysGold });

      const result = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(result.ok).toBe(true);

      const score = await client.query<{ agreed: boolean }>(
        `SELECT agreed FROM gold_item_scores WHERE item_id = $1 AND reviewer_id = $2`,
        [itemId, world.reviewerId],
      );
      expect(score.rows[0]?.agreed).toBe(true);

      const reviewer = await client.query<{ accuracy_score: string }>(
        `SELECT accuracy_score FROM reviewers WHERE id = $1`,
        [world.reviewerId],
      );
      expect(Number(reviewer.rows[0]?.accuracy_score)).toBe(1);

      const earning = await client.query<{ amount_kobo: string }>(
        `SELECT amount_kobo FROM reviewer_earnings re
           JOIN review_decisions rd ON rd.id = re.review_decision_id
          WHERE rd.item_id = $1 AND rd.reviewer_id = $2`,
        [itemId, world.reviewerId],
      );
      expect(Number(earning.rows[0]?.amount_kobo)).toBe(5000);
    });
  });

  it('decideOnItem pays the second-review bonus when the decision resolves needs_second_review', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'high' });

      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      await decisions.submitBlindAnswer(world.reviewerId, itemId, 'A');
      await decisions.revealItem(world.reviewerId, itemId);
      const first = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(first).toMatchObject({ status: 'needs_second_review' });

      await queue.getNextItemBatch(world.secondReviewerId, 1, { random: neverGold });
      const second = await decisions.decideOnItem(world.secondReviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });
      expect(second).toMatchObject({ status: 'approved_uncalibrated' });

      // First reviewer: high-tier bonus only (8000) — their decision did not
      // resolve needs_second_review, it created it.
      const firstEarning = await client.query<{ amount_kobo: string }>(
        `SELECT re.amount_kobo FROM reviewer_earnings re
           JOIN review_decisions rd ON rd.id = re.review_decision_id
          WHERE rd.item_id = $1 AND rd.reviewer_id = $2`,
        [itemId, world.reviewerId],
      );
      expect(Number(firstEarning.rows[0]?.amount_kobo)).toBe(8000);

      // Second reviewer: high-tier bonus AND second-review bonus (10000) —
      // their decision is what actually resolved it.
      const secondEarning = await client.query<{ amount_kobo: string }>(
        `SELECT re.amount_kobo FROM reviewer_earnings re
           JOIN review_decisions rd ON rd.id = re.review_decision_id
          WHERE rd.item_id = $1 AND rd.reviewer_id = $2`,
        [itemId, world.secondReviewerId],
      );
      expect(Number(secondEarning.rows[0]?.amount_kobo)).toBe(10000);
    });
  });

  it('decideOnItem records an earning for a late-arrival decision too, at the base/high-tier rate but never the second-review bonus', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.reviewerId, 1, { random: neverGold });
      await client.query(
        `UPDATE review_claims SET claimed_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE item_id = $1`,
        [itemId],
      );
      await queue.releaseExpiredClaims();
      await queue.getNextItemBatch(world.secondReviewerId, 1, { random: neverGold });
      await decisions.decideOnItem(world.secondReviewerId, itemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });

      const lateArrival = await decisions.decideOnItem(world.reviewerId, itemId, {
        action: 'reject',
        rejectionReason: 'wrong_key',
        edits: null,
      });
      expect(lateArrival).toMatchObject({ decisionContext: 'late_arrival' });

      const earning = await client.query<{ amount_kobo: string }>(
        `SELECT re.amount_kobo FROM reviewer_earnings re
           JOIN review_decisions rd ON rd.id = re.review_decision_id
          WHERE rd.item_id = $1 AND rd.reviewer_id = $2`,
        [itemId, world.reviewerId],
      );
      expect(Number(earning.rows[0]?.amount_kobo)).toBe(5000);
    });
  });

  it('decideOnItem returns an identically-shaped outcome for a gold item and an ordinary one — gold-item scoring never leaks through the response', async () => {
    await withWorld(async ({ world, fixtures, client, queue, decisions }) => {
      const goldItemId = await fixtures.insertQueueItem(client, world, {
        riskTier: 'low',
        gold: { referenceDecision: 'approve', referenceKey: 'A', plantedErrorType: null },
      });
      // Gold items are excluded from ordinary serving unless the draw
      // fires — force it here, the same way the scoring test above does.
      await queue.getNextItemBatch(world.reviewerId, 1, { random: alwaysGold });
      const goldResult = await decisions.decideOnItem(world.reviewerId, goldItemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });

      const ordinaryItemId = await fixtures.insertQueueItem(client, world, { riskTier: 'low' });
      await queue.getNextItemBatch(world.secondReviewerId, 1, { random: neverGold });
      const ordinaryResult = await decisions.decideOnItem(world.secondReviewerId, ordinaryItemId, {
        action: 'approve',
        rejectionReason: null,
        edits: null,
      });

      // Same key set on both — nothing about gold scoring rides along on
      // the outcome object, and TypeScript's own DecideResult type (four
      // fixed fields) makes this the only shape either branch can produce.
      expect(Object.keys(goldResult).sort()).toEqual(Object.keys(ordinaryResult).sort());
      // Same status/approvalRoute/decisionContext values too — a low-tier,
      // sole reviewer, live approval lands identically regardless of gold.
      expect(goldResult).toMatchObject({
        ok: true,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'live',
      });
      expect(ordinaryResult).toMatchObject({
        ok: true,
        status: 'approved_uncalibrated',
        approvalRoute: 'human_reviewed',
        decisionContext: 'live',
      });

      // The one place gold status is genuinely, silently recorded — never
      // reflected back to the caller of decideOnItem above.
      const score = await client.query('SELECT 1 FROM gold_item_scores WHERE item_id = $1', [
        goldItemId,
      ]);
      expect(score.rowCount).toBe(1);
    });
  });
});
