import type { Pool, PoolClient } from 'pg';
import {
  apportionBriefFeeKobo,
  detectCoverageGaps,
  isBriefClaimable,
  type BriefStatus,
  type CoverageGap,
  type ItemFacts,
} from '@jamb/shared';
import { pool } from './client';
import { firstRow } from './first-row';
import { loadReviewer, withTransaction } from './review-queue-repository';
import { APPROVED_STATUSES } from './content-dashboard-repository';
import {
  insertGeneratedItem,
  loadObjectiveContext,
  promoteGeneratedItem,
  type GeneratedOptionInsert,
} from './item-generation-repository';

/**
 * The contributor brief board's own database access (plan 7.12, canonical
 * session 11, Phase 1 — text items). Gap detection, brief creation/claiming,
 * and submission of a contributor-authored item into the ordinary review
 * queue via the same insert-then-`gates_passed` pattern the generation
 * pipeline already established.
 */

export interface ObjectiveCoverageRow {
  objectiveId: number;
  approvedCount: number;
  targetItemCount: number;
  requiresHumanAuthorship: boolean;
}

/**
 * Every objective with a target set, and how many approved items it
 * currently has. `gap-detection-policy.ts`'s `detectCoverageGaps` decides
 * which of these are actually short — this only supplies the raw counts.
 */
export async function loadObjectiveCoverage(client?: PoolClient): Promise<ObjectiveCoverageRow[]> {
  const runner: Pool | PoolClient = client ?? pool;
  const result = await runner.query<{
    objective_id: number;
    target_item_count: number;
    requires_human_authorship: boolean;
    approved_count: string;
  }>(
    `SELECT o.id AS objective_id,
            o.target_item_count,
            o.requires_human_authorship,
            count(i.id) FILTER (WHERE i.status = ANY($1)) AS approved_count
       FROM objectives o
       LEFT JOIN items i ON i.objective_id = o.id
      WHERE o.target_item_count IS NOT NULL
      GROUP BY o.id, o.target_item_count, o.requires_human_authorship`,
    [APPROVED_STATUSES],
  );

  return result.rows.map((row) => ({
    objectiveId: row.objective_id,
    targetItemCount: row.target_item_count,
    requiresHumanAuthorship: row.requires_human_authorship,
    approvedCount: Number(row.approved_count),
  }));
}

/** Composes `loadObjectiveCoverage` with the pure gap-detection decision — the public entry point for the content-lead dashboard's gap list. */
export async function getCoverageGaps(client?: PoolClient): Promise<CoverageGap[]> {
  const coverage = await loadObjectiveCoverage(client);
  return detectCoverageGaps(coverage);
}

export interface BriefInsert {
  objectiveId: number;
  itemCount: number;
  difficultySpread: Record<string, unknown>;
  cognitiveLevels: Record<string, unknown>;
  styleNotes: string | null;
  feeKobo: number;
  deadline: Date;
}

export interface Brief {
  id: number;
  objectiveId: number;
  itemCount: number;
  difficultySpread: unknown;
  cognitiveLevels: unknown;
  styleNotes: string | null;
  feeKobo: number;
  deadline: Date;
  status: BriefStatus;
  createdByUserId: number;
  claimedByUserId: number | null;
  claimedAt: Date | null;
}

interface BriefRow {
  id: number;
  objective_id: number;
  item_count: number;
  difficulty_spread: unknown;
  cognitive_levels: unknown;
  style_notes: string | null;
  fee_kobo: string;
  deadline: Date;
  status: BriefStatus;
  created_by: number;
  claimed_by: number | null;
  claimed_at: Date | null;
}

function toBrief(row: BriefRow): Brief {
  return {
    id: row.id,
    objectiveId: row.objective_id,
    itemCount: row.item_count,
    difficultySpread: row.difficulty_spread,
    cognitiveLevels: row.cognitive_levels,
    styleNotes: row.style_notes,
    feeKobo: Number(row.fee_kobo),
    deadline: row.deadline,
    status: row.status,
    createdByUserId: row.created_by,
    claimedByUserId: row.claimed_by,
    claimedAt: row.claimed_at,
  };
}

/**
 * `createdByReviewerId` (like `contributorReviewerId` below, and like every
 * other identity parameter in this codebase's decision-recording functions)
 * is a `reviewers.id`, never a `users.id` — the session only ever carries a
 * reviewer id, so `loadReviewer` resolves the underlying `users.id` here,
 * the same pattern `decideOnItem`/`resolveEscalation` already use. This also
 * gets the active-reviewer check for free: `loadReviewer` throws
 * `ReviewerNotActiveError` for anyone whose account isn't active.
 */
export async function createBrief(input: BriefInsert, createdByReviewerId: number): Promise<number> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, createdByReviewerId);
    return firstRow(
      await client.query<{ id: number }>(
        `INSERT INTO briefs (
           objective_id, item_count, difficulty_spread, cognitive_levels,
           style_notes, fee_kobo, deadline, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.objectiveId,
          input.itemCount,
          JSON.stringify(input.difficultySpread),
          JSON.stringify(input.cognitiveLevels),
          input.styleNotes,
          input.feeKobo,
          input.deadline,
          reviewer.user_id,
        ],
      ),
    ).id;
  });
}

export async function listOpenBriefs(client?: PoolClient): Promise<Brief[]> {
  const runner: Pool | PoolClient = client ?? pool;
  const result = await runner.query<BriefRow>(
    `SELECT * FROM briefs WHERE status = 'open' ORDER BY deadline, id`,
  );
  return result.rows.map(toBrief);
}

export class BriefNotFoundError extends Error {
  constructor(public readonly briefId: number) {
    super(`brief ${briefId} not found`);
    this.name = 'BriefNotFoundError';
  }
}

export class BriefNotClaimableError extends Error {
  constructor(
    public readonly briefId: number,
    public readonly status: BriefStatus,
  ) {
    super(`brief ${briefId} is not claimable (status: ${status})`);
    this.name = 'BriefNotClaimableError';
  }
}

export class BriefNotClaimedByContributorError extends Error {
  constructor(
    public readonly briefId: number,
    public readonly contributorReviewerId: number,
  ) {
    super(`brief ${briefId} is not claimed by reviewer ${contributorReviewerId}`);
    this.name = 'BriefNotClaimedByContributorError';
  }
}

/**
 * Claims one open brief for a contributor. `FOR UPDATE SKIP LOCKED` inside
 * `withTransaction`'s READ COMMITTED transaction is the same concurrency-safe
 * pattern `review-queue-repository.ts`'s item-claiming already established:
 * the row lock is what makes two simultaneous callers disjoint, and
 * `SKIP LOCKED` means a caller who loses the race gets "not found" rather
 * than blocking behind the winner.
 *
 * The claimability check itself is `isBriefClaimable` from
 * `packages/shared` — not re-derived in SQL — so the rule lives in exactly
 * one place and stays testable in isolation.
 */
export async function claimBrief(briefId: number, contributorReviewerId: number): Promise<Brief> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, contributorReviewerId);

    const result = await client.query<BriefRow>(`SELECT * FROM briefs WHERE id = $1 FOR UPDATE SKIP LOCKED`, [
      briefId,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new BriefNotFoundError(briefId);
    }
    if (!isBriefClaimable(row.status)) {
      throw new BriefNotClaimableError(briefId, row.status);
    }

    const updated = firstRow(
      await client.query<BriefRow>(
        `UPDATE briefs SET status = 'claimed', claimed_by = $2, claimed_at = now()
         WHERE id = $1 RETURNING *`,
        [briefId, reviewer.user_id],
      ),
    );
    return toBrief(updated);
  });
}

export interface ContributedItemDraft {
  stem: string;
  explanation: string;
  methodSteps: string[];
  cognitiveLevel: string;
  authorDifficulty: number;
  expectedTimeSeconds: number;
  options: GeneratedOptionInsert[];
}

/**
 * Submits one contributor-authored item against a claimed brief. Reuses
 * `insertGeneratedItem`/`promoteGeneratedItem` exactly as the generation
 * pipeline does — the entry event is `gates_passed` (legal from `generated`,
 * no human-actor requirement), with `contributorUserId` set so the item
 * carries the self-review exclusion (`assertNotOwnContribution`,
 * `isEligibleForReviewer`) into the ordinary review queue automatically.
 *
 * Marks the brief `completed` once submissions reach `item_count` — this
 * only tracks submission progress, not payment; a contributor's fee is
 * recorded separately, per item, at that item's approval (see
 * `review-decision-repository.ts`).
 */
export async function submitContributedItem(
  briefId: number,
  contributorReviewerId: number,
  draft: ContributedItemDraft,
  occurredAt: Date,
): Promise<number> {
  return withTransaction(async (client) => {
    const reviewer = await loadReviewer(client, contributorReviewerId);

    const briefResult = await client.query<BriefRow>(`SELECT * FROM briefs WHERE id = $1 FOR UPDATE`, [
      briefId,
    ]);
    const brief = briefResult.rows[0];
    if (!brief) {
      throw new BriefNotFoundError(briefId);
    }
    if (brief.claimed_by !== reviewer.user_id) {
      throw new BriefNotClaimedByContributorError(briefId, contributorReviewerId);
    }

    const context = await loadObjectiveContext(client, brief.objective_id);
    const contributorUserId = reviewer.user_id;

    const itemId = await insertGeneratedItem(client, {
      subjectId: context.subjectId,
      topicId: context.topicId,
      subtopicId: context.subtopicId,
      objectiveId: context.objectiveId,
      stem: draft.stem,
      explanation: draft.explanation,
      methodSteps: draft.methodSteps,
      cognitiveLevel: draft.cognitiveLevel,
      authorDifficulty: draft.authorDifficulty,
      expectedTimeSeconds: draft.expectedTimeSeconds,
      riskTier: 'not_generated',
      independentSolveVerdict: 'not_run',
      sampledForReview: false,
      stemEmbedding: null,
      inferenceCostUsd: null,
      provenance: { contributorUserId, briefId, submittedAt: occurredAt.toISOString() },
      options: draft.options,
      contributorId: contributorUserId,
      briefId,
    });

    const itemFacts: ItemFacts = {
      contributorUserId,
      riskTier: 'not_generated',
      independentSolveVerdict: 'not_run',
      sampledForReview: false,
    };
    await promoteGeneratedItem(client, itemId, itemFacts, { type: 'gates_passed' }, occurredAt);

    const submittedCountResult = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM items WHERE brief_id = $1`,
      [briefId],
    );
    if (Number(firstRow(submittedCountResult).count) >= brief.item_count) {
      await client.query(`UPDATE briefs SET status = 'completed' WHERE id = $1`, [briefId]);
    }

    return itemId;
  });
}

/**
 * Records a contributor's fee share for one approved item (plan 7.12 step
 * 7), called from `decideOnItem` in the same transaction as the decision
 * that approved it — exactly where reviewer earnings are already recorded
 * for that decision. Fires per item, at that item's own approval, not held
 * until the whole brief completes (this session's payment-timing decision).
 *
 * Locks the brief row for the duration of the computation: two items from
 * the same brief approved at nearly the same moment must not both compute
 * `alreadyPaidCount` from the same stale count, which could either
 * miscalculate the final remainder or, in a worse interleaving, credit the
 * "last item" remainder to two items at once. The brief's own item count is
 * small by construction (a handful of items per brief), so serializing on
 * it costs nothing that matters.
 */
export async function recordContributorFeeOnApproval(
  client: PoolClient,
  itemId: number,
  briefId: number,
): Promise<void> {
  const brief = firstRow(
    await client.query<{ fee_kobo: string; item_count: number }>(
      `SELECT fee_kobo, item_count FROM briefs WHERE id = $1 FOR UPDATE`,
      [briefId],
    ),
  );

  const item = firstRow(
    await client.query<{ contributor_id: number | null }>(
      `SELECT contributor_id FROM items WHERE id = $1`,
      [itemId],
    ),
  );
  if (item.contributor_id === null) {
    throw new Error(
      `recordContributorFeeOnApproval: item ${itemId} has brief_id ${briefId} but no contributor_id — every brief-linked item must have one`,
    );
  }

  const reviewerRow = firstRow(
    await client.query<{ id: number }>(`SELECT id FROM reviewers WHERE user_id = $1`, [
      item.contributor_id,
    ]),
  );

  const alreadyPaidResult = await client.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM reviewer_earnings re
       JOIN items i ON i.id = re.brief_item_id
      WHERE i.brief_id = $1`,
    [briefId],
  );
  const alreadyPaidCount = Number(firstRow(alreadyPaidResult).count);

  const amountKobo = apportionBriefFeeKobo(Number(brief.fee_kobo), brief.item_count, alreadyPaidCount);

  await client.query(
    `INSERT INTO reviewer_earnings (reviewer_id, amount_kobo, rate_basis, brief_item_id)
     VALUES ($1, $2, $3, $4)`,
    [
      reviewerRow.id,
      amountKobo,
      JSON.stringify({ type: 'contributor_fee', briefId, alreadyPaidCount }),
      itemId,
    ],
  );
}
