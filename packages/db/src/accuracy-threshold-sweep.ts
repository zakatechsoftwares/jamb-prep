import type { PoolClient } from 'pg';
import {
  evaluateAccuracyThreshold,
  transition,
  type AccuracyThresholdConfig,
  type ApprovalRoute,
  type IndependentSolveVerdict,
  type ItemStatus,
  type RiskTier,
} from '@jamb/shared';
import { firstRow } from './first-row';
import { recordTransition } from './review-queue-repository';

export type ThresholdSweepVerdict = 'no_data' | 'ok' | 'recalibrate' | 'deactivate';

export interface ThresholdSweepResult {
  verdict: ThresholdSweepVerdict;
  consecutiveFailures: number;
  requeuedItemIds: number[];
}

/**
 * One reviewer's accuracy-threshold check (plan 7.11). No cron exists in
 * this codebase — this is an idempotent, on-demand function a route or
 * script calls per reviewer, not a literal scheduled job.
 *
 * `'no_data'`: the reviewer has never decided on a gold item, so there is
 * nothing to evaluate — `accuracy_score` is NULL until then, and evaluating
 * a threshold against no data would be meaningless.
 *
 * `'recalibrate'`: re-issues the 30-item calibration set — narrowly, this
 * sets `status = 'calibrating'`, the same status a brand-new reviewer
 * starts in, which is what actually blocks queue access (`loadReviewer`
 * throws `ReviewerNotActiveError` for anything but `'active'`). Generating
 * an actual 30-item calibration set is a separate, unbuilt mechanism (no
 * calibration-item-selection exists anywhere in this codebase yet) — this
 * function only ever changes the reviewer's status, which is the real gate.
 *
 * `'deactivate'`: sustained failure. Sets `status = 'removed'` and
 * requeues the reviewer's own recent `approved_uncalibrated` approvals
 * (not yet calibrated — an item with real usage data behind it is a
 * different question) for fresh review, via the existing `quarantined`
 * then `reworked` transitions rather than a new event type — a low-accuracy
 * reviewer's approval is exactly the kind of quality concern quarantine
 * already exists for. **Earnings for those decisions are never clawed
 * back** — the work was genuinely done at the time, and removal from the
 * panel is the remedy, not retroactively unpaid work. See
 * `reviewer_earnings`'s own migration comment for the same statement.
 */
export async function sweepReviewerAccuracy(
  client: PoolClient,
  reviewerId: number,
  occurredAt: Date,
): Promise<ThresholdSweepResult> {
  const reviewerRow = firstRow(
    await client.query<{ accuracy_score: string | null; consecutive_low_accuracy_count: number }>(
      `SELECT accuracy_score, consecutive_low_accuracy_count FROM reviewers WHERE id = $1 FOR UPDATE`,
      [reviewerId],
    ),
  );

  if (reviewerRow.accuracy_score === null) {
    return { verdict: 'no_data', consecutiveFailures: 0, requeuedItemIds: [] };
  }

  const configRow = (
    await client.query<{ threshold_rate: string; sustained_failure_count: number }>(
      `SELECT threshold_rate, sustained_failure_count FROM accuracy_threshold_configs WHERE active`,
    )
  ).rows[0];
  if (!configRow) {
    throw new Error('sweepReviewerAccuracy: no accuracy_threshold_configs row is currently active');
  }
  const config: AccuracyThresholdConfig = {
    thresholdRate: Number(configRow.threshold_rate),
    sustainedFailureCount: configRow.sustained_failure_count,
  };

  const outcome = evaluateAccuracyThreshold(
    config,
    Number(reviewerRow.accuracy_score),
    reviewerRow.consecutive_low_accuracy_count,
  );

  await client.query(`UPDATE reviewers SET consecutive_low_accuracy_count = $2 WHERE id = $1`, [
    reviewerId,
    outcome.consecutiveFailures,
  ]);

  if (outcome.verdict === 'ok') {
    return { verdict: 'ok', consecutiveFailures: 0, requeuedItemIds: [] };
  }

  if (outcome.verdict === 'recalibrate') {
    await client.query(`UPDATE reviewers SET status = 'calibrating' WHERE id = $1`, [reviewerId]);
    return { verdict: 'recalibrate', consecutiveFailures: outcome.consecutiveFailures, requeuedItemIds: [] };
  }

  await client.query(`UPDATE reviewers SET status = 'removed' WHERE id = $1`, [reviewerId]);
  const requeuedItemIds = await requeueRecentApprovals(client, reviewerId, occurredAt);
  return { verdict: 'deactivate', consecutiveFailures: outcome.consecutiveFailures, requeuedItemIds };
}

async function requeueRecentApprovals(
  client: PoolClient,
  reviewerId: number,
  occurredAt: Date,
): Promise<number[]> {
  const candidates = await client.query<{
    id: number;
    contributor_id: number | null;
    risk_tier: RiskTier;
    independent_solve_verdict: IndependentSolveVerdict;
    sampled_for_review: boolean;
  }>(
    `SELECT DISTINCT i.id, i.contributor_id, i.risk_tier, i.independent_solve_verdict, i.sampled_for_review
       FROM items i
       JOIN review_decisions rd ON rd.item_id = i.id
      WHERE rd.reviewer_id = $1
        AND rd.action IN ('approve', 'edit_and_approve')
        AND i.status = 'approved_uncalibrated'
      ORDER BY i.id`,
    [reviewerId],
  );

  const requeuedItemIds: number[] = [];

  for (const candidate of candidates.rows) {
    const itemFacts = {
      contributorUserId: candidate.contributor_id,
      riskTier: candidate.risk_tier,
      independentSolveVerdict: candidate.independent_solve_verdict,
      sampledForReview: candidate.sampled_for_review,
    };
    const systemActor = { userId: null, role: 'system' as const };

    const quarantineResult = transition(
      'approved_uncalibrated',
      { type: 'quarantined' },
      { item: itemFacts, actor: systemActor, occurredAt, priorDecisions: [] },
    );
    await applyRequeueTransition(client, candidate.id, 'approved_uncalibrated', quarantineResult, 'quarantined');

    const reworkResult = transition(
      'quarantined',
      { type: 'reworked' },
      { item: itemFacts, actor: systemActor, occurredAt, priorDecisions: [] },
    );
    await applyRequeueTransition(client, candidate.id, 'quarantined', reworkResult, 'reworked');

    requeuedItemIds.push(candidate.id);
  }

  return requeuedItemIds;
}

async function applyRequeueTransition(
  client: PoolClient,
  itemId: number,
  fromStatus: ItemStatus,
  result: {
    status: ItemStatus;
    approvalRoute: ApprovalRoute | null;
    actorUserId: number | null;
    occurredAt: Date;
  },
  event: string,
): Promise<void> {
  await client.query(
    `UPDATE items SET status = $2, approval_route = COALESCE($3, approval_route) WHERE id = $1`,
    [itemId, result.status, result.approvalRoute],
  );
  await recordTransition(
    client,
    itemId,
    fromStatus,
    result.status,
    event,
    result.actorUserId,
    'system',
    result.occurredAt,
    result.approvalRoute,
  );
}
