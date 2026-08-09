import type { PoolClient } from 'pg';
import {
  shouldServeGoldItem,
  transition,
  validateReviewQueueConfig,
  type ApprovalRoute,
  type IndependentSolveVerdict,
  type ItemStatus,
  type PanelRole,
  type PriorDecision,
  type ReviewQueueConfig,
  type ReviewQueueItem,
} from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';

/**
 * The priority bands from plan 7.9, in SQL. This must stay identical to
 * `priorityOf` in @jamb/shared — `review-queue-ranking.integration.test.ts`
 * asserts the two agree over every combination of item facts, because a
 * silent divergence here changes which item a reviewer sees and nothing
 * else would notice.
 */
export const QUEUE_PRIORITY_SQL = `CASE
    WHEN i.independent_solve_verdict = 'disagreed' THEN 1
    WHEN i.risk_tier = 'high' THEN 2
    WHEN i.status = 'needs_second_review' THEN 3
    WHEN i.gate_flagged THEN 4
    ELSE 5
  END`;

/**
 * `requiresHumanReview` in SQL: the negated 7.14 triple, with second
 * reviews and gate-flagged items queueable regardless of the sampling draw.
 */
export const REQUIRES_HUMAN_REVIEW_SQL = `i.status IN ('pending_review', 'needs_second_review')
  AND (
    i.status = 'needs_second_review'
    OR i.gate_flagged
    OR NOT (
      i.risk_tier = 'low'
      AND NOT i.sampled_for_review
      AND i.independent_solve_verdict = 'agreed'
    )
  )`;

export interface QueueReviewerRow {
  reviewer_id: number;
  user_id: number;
  role: PanelRole;
  status: string;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    // READ COMMITTED, the default, is required: under REPEATABLE READ a
    // FOR UPDATE against a concurrently updated row raises a serialization
    // failure instead of skipping it.
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadActiveQueueConfig(client?: PoolClient): Promise<ReviewQueueConfig> {
  const runner = client ?? pool;
  const result = await runner.query<{
    gold_item_rate: string;
    low_risk_sample_rate: string;
    claim_duration_minutes: number;
    batch_max_size: number;
  }>(
    `SELECT gold_item_rate, low_risk_sample_rate, claim_duration_minutes, batch_max_size
       FROM review_queue_configs
      WHERE active`,
  );

  const row = firstRow(result);
  const config: ReviewQueueConfig = {
    // NUMERIC comes back as a string from pg; parsing it here rather than
    // at the call site keeps the units in one place.
    goldItemRate: Number(row.gold_item_rate),
    lowRiskSampleRate: Number(row.low_risk_sample_rate),
    claimDurationMinutes: row.claim_duration_minutes,
    batchMaxSize: row.batch_max_size,
  };

  validateReviewQueueConfig(config);
  return config;
}

export async function loadReviewer(
  client: PoolClient,
  reviewerId: number,
): Promise<QueueReviewerRow> {
  const result = await client.query<QueueReviewerRow>(
    `SELECT r.id AS reviewer_id, r.user_id, r.role, r.status
       FROM reviewers r
      WHERE r.id = $1`,
    [reviewerId],
  );

  const reviewer = firstRow(result);

  if (reviewer.status !== 'active') {
    throw new Error(
      `getNextItem: reviewer ${reviewerId} is '${reviewer.status}', not active — only an activated reviewer is served items (7.8)`,
    );
  }

  return reviewer;
}

interface LockedCandidate {
  id: number;
  status: ItemStatus;
  contributor_id: number | null;
  risk_tier: string;
  independent_solve_verdict: string;
  sampled_for_review: boolean;
}

/**
 * Locks up to `limit` queue candidates for this reviewer and returns them
 * in priority order.
 *
 * `FOR UPDATE OF i SKIP LOCKED` is what makes two simultaneous callers
 * disjoint. The claim row alone cannot do it: under READ COMMITTED a
 * concurrent caller's snapshot may predate the other's commit, so its
 * `NOT EXISTS (review_claims ...)` would not see the claim. The row lock
 * closes that window; the claim row provides the exclusion that outlives
 * the transaction. Both are needed.
 *
 * `EXISTS` subqueries rather than joins, because Postgres refuses
 * `FOR UPDATE` alongside aggregates, DISTINCT, GROUP BY or UNION, and
 * locking the nullable side of an outer join means nothing.
 */
async function lockCandidates(
  client: PoolClient,
  reviewer: QueueReviewerRow,
  limit: number,
  goldOnly: boolean,
): Promise<LockedCandidate[]> {
  const result = await client.query<LockedCandidate>(
    `SELECT i.id, i.status, i.contributor_id, i.risk_tier,
            i.independent_solve_verdict, i.sampled_for_review
       FROM items i
      WHERE ${REQUIRES_HUMAN_REVIEW_SQL}
        AND EXISTS (
              SELECT 1 FROM reviewer_subjects rs
               WHERE rs.reviewer_id = $1 AND rs.subject_id = i.subject_id
            )
        AND i.contributor_id IS DISTINCT FROM $2
        AND NOT EXISTS (
              SELECT 1 FROM review_decisions d
               WHERE d.item_id = i.id AND d.reviewer_id = $1
            )
        AND NOT EXISTS (
              SELECT 1 FROM review_claims c
               WHERE c.item_id = i.id AND c.expires_at > now()
            )
        AND EXISTS (SELECT 1 FROM gold_items g WHERE g.item_id = i.id) = $4
      ORDER BY ${QUEUE_PRIORITY_SQL}, i.created_at, i.id
        FOR UPDATE OF i SKIP LOCKED
      LIMIT $3`,
    [reviewer.reviewer_id, reviewer.user_id, limit, goldOnly],
  );

  return result.rows;
}

/**
 * Item ids this reviewer already holds a live, unexpired claim on, in the
 * same priority order `lockCandidates` would use — so a reviewer who
 * re-polls while still holding one or more claims (a page reload mid-item
 * is the real-world trigger) gets exactly what they already hold, not a
 * fresh assignment. These items need no re-claiming: they are already
 * `in_review`, already rowed in `review_claims`, and `lockCandidates`
 * already excludes any item with a live claim — including this reviewer's
 * own — so there is no risk of this set overlapping whatever
 * `lockCandidates` returns afterward.
 */
async function ownLiveClaims(
  client: PoolClient,
  reviewer: QueueReviewerRow,
  limit: number,
): Promise<number[]> {
  const result = await client.query<{ item_id: number }>(
    `SELECT c.item_id
       FROM review_claims c
       JOIN items i ON i.id = c.item_id
      WHERE c.reviewer_id = $1 AND c.expires_at > now()
      ORDER BY ${QUEUE_PRIORITY_SQL}, i.created_at, i.id
      LIMIT $2`,
    [reviewer.reviewer_id, limit],
  );

  return result.rows.map((row) => row.item_id);
}

/** Prior decisions per item, keyed by item id, as the state machine wants them. */
export async function loadPriorDecisions(
  client: PoolClient,
  itemIds: number[],
): Promise<Map<number, PriorDecision[]>> {
  const result = await client.query<{ item_id: number; user_id: number; action: string }>(
    `SELECT d.item_id, r.user_id, d.action
       FROM review_decisions d
       JOIN reviewers r ON r.id = d.reviewer_id
      WHERE d.item_id = ANY($1::bigint[])
      ORDER BY d.created_at, d.id`,
    [itemIds],
  );

  const byItem = new Map<number, PriorDecision[]>();

  for (const row of result.rows) {
    const decisions = byItem.get(row.item_id) ?? [];
    decisions.push({
      reviewerUserId: row.user_id,
      action: row.action as PriorDecision['action'],
    });
    byItem.set(row.item_id, decisions);
  }

  return byItem;
}

/**
 * Writes one row to the audit trail. Every caller passes the same
 * `approvalRoute` its `transition()` call returned — no call site before
 * `decideOnItem` (packages/db/src/review-decision-repository.ts) ever
 * produced a non-null route, which is why this parameter went unpopulated
 * from 0012 through 0013 without anything noticing. `reviewer_decided` is
 * the first event that can establish `human_reviewed`.
 */
export async function recordTransition(
  client: PoolClient,
  itemId: number,
  fromStatus: ItemStatus,
  toStatus: ItemStatus,
  event: string,
  actorUserId: number | null,
  actorRole: string,
  occurredAt: Date,
  approvalRoute: ApprovalRoute | null,
): Promise<void> {
  await client.query(
    `INSERT INTO item_state_transitions (
       item_id, from_status, to_status, event, actor_user_id, actor_role, occurred_at, approval_route
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [itemId, fromStatus, toStatus, event, actorUserId, actorRole, occurredAt, approvalRoute],
  );
}

async function claimItems(
  client: PoolClient,
  reviewer: QueueReviewerRow,
  candidates: LockedCandidate[],
  config: ReviewQueueConfig,
): Promise<number[]> {
  if (candidates.length === 0) {
    return [];
  }

  const priorDecisions = await loadPriorDecisions(
    client,
    candidates.map((candidate) => candidate.id),
  );
  const occurredAt = new Date();
  const claimed: number[] = [];

  for (const candidate of candidates) {
    // The new state comes from the state machine, not from a literal here.
    // Its guards (never your own item, never a second decision from the
    // same reviewer) run against the same facts the SQL filtered on.
    const result = transition(
      candidate.status,
      { type: 'claimed' },
      {
        item: {
          contributorUserId: candidate.contributor_id,
          riskTier: candidate.risk_tier as 'low' | 'high' | 'not_generated',
          independentSolveVerdict: candidate.independent_solve_verdict as
            'agreed' | 'disagreed' | 'not_run',
          sampledForReview: candidate.sampled_for_review,
        },
        actor: { userId: reviewer.user_id, role: reviewer.role },
        occurredAt,
        priorDecisions: priorDecisions.get(candidate.id) ?? [],
      },
    );

    // An expired claim row survives until the sweeper removes it, and
    // review_claims is keyed on item_id, so a plain INSERT would collide
    // with it. The WHERE on the conflict path is what stops this from
    // stealing a claim that is still live.
    //
    // reviewer_answer is explicitly reset to NULL on the conflict path, as
    // defense in depth: this branch is not reachable today, because
    // lockCandidates gates candidacy on items.status, and the only path
    // that returns status to a candidate value after an expiry
    // (releaseExpiredClaims) also deletes this row in the same step — so a
    // real reclaim is always a fresh INSERT, which starts blank regardless.
    // The reset stays anyway, so a future change to either of those two
    // facts cannot quietly resurrect a previous reviewer's answer for
    // whoever claims the item next. See
    // review-decision.integration.test.ts for the test that exercises this
    // branch directly, since the application itself cannot reach it. The
    // claimed_at column update is what the immutability trigger in
    // migration 0014 reads to tell "a fresh claim episode" apart from "an
    // attempt to rewrite an answer within the same one".
    await client.query(
      `INSERT INTO review_claims (item_id, reviewer_id, claimed_at, expires_at)
       VALUES ($1, $2, $3::timestamptz, $3::timestamptz + make_interval(mins => $4))
       ON CONFLICT (item_id) DO UPDATE
          SET reviewer_id = EXCLUDED.reviewer_id,
              claimed_at = EXCLUDED.claimed_at,
              expires_at = EXCLUDED.expires_at,
              reviewer_answer = NULL
        WHERE review_claims.expires_at <= now()`,
      [candidate.id, reviewer.reviewer_id, occurredAt, config.claimDurationMinutes],
    );

    await client.query(`UPDATE items SET status = $2 WHERE id = $1`, [candidate.id, result.status]);

    await recordTransition(
      client,
      candidate.id,
      candidate.status,
      result.status,
      'claimed',
      result.actorUserId,
      reviewer.role,
      result.occurredAt,
      result.approvalRoute,
    );

    claimed.push(candidate.id);
  }

  return claimed;
}

async function loadItemPayloads(
  client: PoolClient,
  itemIds: number[],
): Promise<Map<number, Omit<ReviewQueueItem, 'claimExpiresAt'>>> {
  const result = await client.query<{
    id: number;
    subject_id: number;
    objective_id: number;
    stem: string;
    cognitive_level: string;
    independent_solve_verdict: IndependentSolveVerdict;
    options: { label: string; text: string }[];
  }>(
    `SELECT i.id, i.subject_id, i.objective_id, i.stem, i.cognitive_level,
            i.independent_solve_verdict,
            COALESCE(
              (SELECT json_agg(json_build_object('label', o.label, 'text', o.option_text)
                               ORDER BY o.label)
                 FROM item_options o WHERE o.item_id = i.id),
              '[]'::json
            ) AS options
       FROM items i
      WHERE i.id = ANY($1::bigint[])`,
    [itemIds],
  );

  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        itemId: row.id,
        subjectId: row.subject_id,
        objectiveId: row.objective_id,
        stem: row.stem,
        options: row.options,
        cognitiveLevel: row.cognitive_level,
        independentSolveVerdict: row.independent_solve_verdict,
      },
    ]),
  );
}

/**
 * Records that the gold-injection draw fired with no eligible gold item for
 * this reviewer (7.11). Written inside the serving transaction, so it
 * cannot be lost while the ordinary item it fell back to is still handed
 * out.
 */
async function recordGoldStockout(client: PoolClient, reviewerId: number): Promise<void> {
  await client.query(
    `INSERT INTO review_queue_gold_stockouts (reviewer_id, occurred_at) VALUES ($1, now())`,
    [reviewerId],
  );
}

export interface GoldStockoutCount {
  reviewerId: number;
  occurrences: number;
}

/**
 * Gold stock-outs since a given moment, by reviewer, for the content lead's
 * dashboard.
 *
 * A count against one reviewer means they have exhausted the gold items in
 * their subjects; a count spread across all of them means the seeded stock
 * itself has run dry. Both stop accuracy measurement, and they need
 * different fixes.
 */
export async function goldStockoutsSince(since: Date): Promise<GoldStockoutCount[]> {
  const result = await pool.query<{ reviewer_id: number; occurrences: number }>(
    `SELECT reviewer_id, count(*)::int AS occurrences
       FROM review_queue_gold_stockouts
      WHERE occurred_at >= $1
      GROUP BY reviewer_id
      ORDER BY occurrences DESC, reviewer_id`,
    [since],
  );

  return result.rows.map((row) => ({
    reviewerId: row.reviewer_id,
    occurrences: row.occurrences,
  }));
}

export interface GetNextItemOptions {
  /** Injected so the gold-injection rate is reproducible in a test. */
  random?: () => number;
}

/**
 * Serves one item to one reviewer, claiming it in the same transaction.
 *
 * The reviewer never chooses (7.9): there is no list, no filter and no
 * browse, precisely so that easy items cannot be cherry-picked. Returns
 * null when nothing in the reviewer's subjects is available.
 */
export async function getNextItem(
  reviewerId: number,
  options: GetNextItemOptions = {},
): Promise<ReviewQueueItem | null> {
  const items = await getNextItemBatch(reviewerId, 1, options);
  return items[0] ?? null;
}

/**
 * Serves up to `count` items at once, for the reviewer workspace's offline
 * cache (7.9). Every item is claimed exactly as a single serve claims one,
 * so a cached batch cannot also be handed to somebody else.
 */
export async function getNextItemBatch(
  reviewerId: number,
  count: number,
  options: GetNextItemOptions = {},
): Promise<ReviewQueueItem[]> {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(
      `getNextItemBatch: count must be a whole number greater than zero, got ${count}`,
    );
  }

  const random = options.random ?? Math.random;

  return withTransaction(async (client) => {
    const config = await loadActiveQueueConfig(client);

    if (count > config.batchMaxSize) {
      throw new Error(
        `getNextItemBatch: count ${count} exceeds the configured batch_max_size of ${config.batchMaxSize}`,
      );
    }

    const reviewer = await loadReviewer(client, reviewerId);

    // A live claim this reviewer already holds is not competing for a
    // priority slot — it wins outright, before the queue is even
    // consulted. Otherwise a reviewer re-polling for work while still
    // holding an item (a page reload mid-item, in particular) would have
    // that claim excluded by lockCandidates' own-live-claim filter same as
    // anyone else's, and be handed something else — stranding the
    // original item in in_review until it naturally expires.
    const ownClaimIds = await ownLiveClaims(client, reviewer, count);
    const remaining = count - ownClaimIds.length;

    // Gold items are drawn per served item, not per request, so a batch
    // carries roughly the configured proportion rather than being wholly
    // gold or wholly ordinary.
    const candidates: LockedCandidate[] = [];

    for (let served = 0; served < remaining; served += 1) {
      const wantsGold = shouldServeGoldItem(config.goldItemRate, random);
      const alreadyTaken = new Set(candidates.map((candidate) => candidate.id));

      let next = (await lockCandidates(client, reviewer, 1 + alreadyTaken.size, wantsGold)).find(
        (candidate) => !alreadyTaken.has(candidate.id),
      );

      // No gold item available is not a reason to serve nothing — but it
      // must not pass unrecorded either. The reviewer notices nothing, the
      // request succeeds, and accuracy measurement quietly stops happening,
      // so this counter is the only thing that can ever surface it.
      if (!next && wantsGold) {
        await recordGoldStockout(client, reviewer.reviewer_id);

        next = (await lockCandidates(client, reviewer, 1 + alreadyTaken.size, false)).find(
          (candidate) => !alreadyTaken.has(candidate.id),
        );
      }

      if (!next) {
        break;
      }

      candidates.push(next);
    }

    const newlyClaimedIds = await claimItems(client, reviewer, candidates, config);
    const claimedIds = [...ownClaimIds, ...newlyClaimedIds];

    if (claimedIds.length === 0) {
      return [];
    }

    const payloads = await loadItemPayloads(client, claimedIds);
    const claims = await client.query<{ item_id: number; expires_at: Date }>(
      `SELECT item_id, expires_at FROM review_claims WHERE item_id = ANY($1::bigint[])`,
      [claimedIds],
    );
    const expiryByItem = new Map(claims.rows.map((row) => [row.item_id, row.expires_at]));

    // Ordered as the queue ordered them, so the batch a reviewer caches is
    // worked in priority order offline.
    return claimedIds.flatMap((itemId) => {
      const payload = payloads.get(itemId);
      const claimExpiresAt = expiryByItem.get(itemId);

      if (!payload || !claimExpiresAt) {
        return [];
      }

      // Gold items are indistinguishable here by construction: nothing in
      // this shape says whether gold_items has a row for it.
      return [{ ...payload, claimExpiresAt }];
    });
  });
}

/**
 * Returns items whose claims have lapsed to the queue (7.9). Run as a
 * background job.
 *
 * The queue query already ignores expired claims, so this is not what makes
 * an abandoned item available again — it is what records that it happened.
 * The `claim_expired` transition is the audit trail's account of where the
 * item went, and the state machine decides whether it lands back in
 * pending_review or needs_second_review.
 */
export async function releaseExpiredClaims(): Promise<number> {
  return withTransaction(async (client) => {
    const expired = await client.query<{
      item_id: number;
      status: ItemStatus;
      contributor_id: number | null;
      risk_tier: string;
      independent_solve_verdict: string;
      sampled_for_review: boolean;
    }>(
      `SELECT c.item_id, i.status, i.contributor_id, i.risk_tier,
              i.independent_solve_verdict, i.sampled_for_review
         FROM review_claims c
         JOIN items i ON i.id = c.item_id
        WHERE c.expires_at <= now()
          FOR UPDATE OF c, i SKIP LOCKED`,
    );

    if (expired.rows.length === 0) {
      return 0;
    }

    const itemIds = expired.rows.map((row) => row.item_id);
    const priorDecisions = await loadPriorDecisions(client, itemIds);
    const occurredAt = new Date();
    let released = 0;

    for (const row of expired.rows) {
      // An item may have been decided between the claim lapsing and this
      // sweep; only one still sitting in in_review needs releasing.
      if (row.status !== 'in_review') {
        await client.query('DELETE FROM review_claims WHERE item_id = $1', [row.item_id]);
        continue;
      }

      const result = transition(
        'in_review',
        { type: 'claim_expired' },
        {
          item: {
            contributorUserId: row.contributor_id,
            riskTier: row.risk_tier as 'low' | 'high' | 'not_generated',
            independentSolveVerdict: row.independent_solve_verdict as
              'agreed' | 'disagreed' | 'not_run',
            sampledForReview: row.sampled_for_review,
          },
          actor: { userId: null, role: 'system' },
          occurredAt,
          priorDecisions: priorDecisions.get(row.item_id) ?? [],
        },
      );

      await client.query('DELETE FROM review_claims WHERE item_id = $1', [row.item_id]);
      await client.query('UPDATE items SET status = $2 WHERE id = $1', [
        row.item_id,
        result.status,
      ]);
      await recordTransition(
        client,
        row.item_id,
        'in_review',
        result.status,
        'claim_expired',
        null,
        'system',
        occurredAt,
        result.approvalRoute,
      );

      released += 1;
    }

    return released;
  });
}

/**
 * Routes a gate-failed item to human judgement, setting the priority-4 flag
 * and recording the transition **in one transaction**.
 *
 * These two writes are never separated. `items.gate_flagged` is a
 * denormalisation of what the transition log already implies, so the moment
 * they can be written apart is the moment they can disagree, and the queue
 * would then prioritise on a fact the audit trail contradicts.
 */
export async function flagForJudgement(
  itemId: number,
  actor: { userId: number; role: PanelRole },
): Promise<ItemStatus> {
  return withTransaction(async (client) => {
    const current = firstRow(
      await client.query<{
        status: ItemStatus;
        contributor_id: number | null;
        risk_tier: string;
        independent_solve_verdict: string;
        sampled_for_review: boolean;
      }>(
        `SELECT status, contributor_id, risk_tier, independent_solve_verdict, sampled_for_review
           FROM items WHERE id = $1 FOR UPDATE`,
        [itemId],
      ),
    );

    const occurredAt = new Date();
    const result = transition(
      current.status,
      { type: 'routed_for_judgement' },
      {
        item: {
          contributorUserId: current.contributor_id,
          riskTier: current.risk_tier as 'low' | 'high' | 'not_generated',
          independentSolveVerdict: current.independent_solve_verdict as
            'agreed' | 'disagreed' | 'not_run',
          sampledForReview: current.sampled_for_review,
        },
        actor,
        occurredAt,
        priorDecisions: [],
      },
    );

    await client.query('UPDATE items SET status = $2, gate_flagged = true WHERE id = $1', [
      itemId,
      result.status,
    ]);

    await recordTransition(
      client,
      itemId,
      current.status,
      result.status,
      'routed_for_judgement',
      actor.userId,
      actor.role,
      occurredAt,
      result.approvalRoute,
    );

    return result.status;
  });
}
