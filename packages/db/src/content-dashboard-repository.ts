import type { PoolClient } from 'pg';
import type {
  CostPerApprovedItem,
  ItemStateCount,
  RejectionReason,
  RejectionReasonCount,
  SubjectQueueDepth,
} from '@jamb/shared';
import { firstRow } from './first-row';

const APPROVED_STATUSES = ['approved_uncalibrated', 'approved_calibrated'];
const QUEUE_WAITING_STATUSES = ['pending_review', 'needs_second_review'];

/**
 * The content lead's dashboard queries (plan 7.11's "accepted items per
 * reviewer-hour... cost per approved item split into inference cost and
 * reviewer fees"). Each metric is its own function so the API layer can
 * compose exactly what a given view needs.
 */

/** Live decisions per reviewer-hour, accepted items only in the numerator, every decided second in the denominator. */
export async function acceptedItemsPerReviewerHour(client: PoolClient, since: Date): Promise<number> {
  const row = firstRow(
    await client.query<{ accepted_count: string; total_seconds: string }>(
      `SELECT
         count(*) FILTER (WHERE action IN ('approve', 'edit_and_approve')) AS accepted_count,
         COALESCE(sum(seconds_taken), 0) AS total_seconds
       FROM review_decisions
       WHERE created_at >= $1 AND decision_context = 'live'`,
      [since],
    ),
  );

  const totalHours = Number(row.total_seconds) / 3600;
  if (totalHours === 0) {
    return 0;
  }
  return Number(row.accepted_count) / totalHours;
}

/** Rejection reasons aggregated by subject and week — sorted so the dominant defect per subject is first, at a glance. */
export async function rejectionReasonsBySubjectAndWeek(
  client: PoolClient,
  since: Date,
): Promise<RejectionReasonCount[]> {
  const result = await client.query<{
    subject_id: number;
    week: Date;
    rejection_reason: RejectionReason;
    count: string;
  }>(
    `SELECT i.subject_id, date_trunc('week', rd.created_at) AS week, rd.rejection_reason, count(*) AS count
       FROM review_decisions rd
       JOIN items i ON i.id = rd.item_id
      WHERE rd.action = 'reject' AND rd.created_at >= $1
      GROUP BY i.subject_id, week, rd.rejection_reason
      ORDER BY i.subject_id, week, count(*) DESC`,
    [since],
  );

  return result.rows.map((row) => ({
    subjectId: row.subject_id,
    week: row.week,
    rejectionReason: row.rejection_reason,
    count: Number(row.count),
  }));
}

/** How many items are currently waiting for a reviewer, per subject — the two states the queue actually serves from. */
export async function queueDepthBySubject(client: PoolClient): Promise<SubjectQueueDepth[]> {
  const result = await client.query<{ subject_id: number; depth: string }>(
    `SELECT subject_id, count(*) AS depth
       FROM items
      WHERE status = ANY($1)
      GROUP BY subject_id
      ORDER BY subject_id`,
    [QUEUE_WAITING_STATUSES],
  );

  return result.rows.map((row) => ({ subjectId: row.subject_id, depth: Number(row.depth) }));
}

/** Every item, grouped by its current lifecycle state — the whole-bank snapshot. */
export async function itemsByState(client: PoolClient): Promise<ItemStateCount[]> {
  const result = await client.query<{ status: string; count: string }>(
    `SELECT status, count(*) AS count FROM items GROUP BY status ORDER BY status`,
  );
  return result.rows.map((row) => ({ status: row.status, count: Number(row.count) }));
}

/** Cost per approved item, split into inference cost and reviewer fees (plan 7.11). */
export async function costPerApprovedItem(client: PoolClient): Promise<CostPerApprovedItem> {
  const inferenceRow = firstRow(
    await client.query<{ approved_count: string; avg_inference_cost_usd: string | null }>(
      `SELECT count(*) AS approved_count, avg(inference_cost_usd) AS avg_inference_cost_usd
         FROM items WHERE status = ANY($1)`,
      [APPROVED_STATUSES],
    ),
  );

  const approvedCount = Number(inferenceRow.approved_count);
  if (approvedCount === 0) {
    return { approvedCount: 0, avgInferenceCostUsd: 0, avgReviewerFeesKobo: 0 };
  }

  const feesRow = firstRow(
    await client.query<{ total_fees_kobo: string | null }>(
      `SELECT COALESCE(sum(re.amount_kobo), 0) AS total_fees_kobo
         FROM reviewer_earnings re
         JOIN review_decisions rd ON rd.id = re.review_decision_id
         JOIN items i ON i.id = rd.item_id
        WHERE i.status = ANY($1)`,
      [APPROVED_STATUSES],
    ),
  );

  return {
    approvedCount,
    avgInferenceCostUsd: Number(inferenceRow.avg_inference_cost_usd ?? 0),
    avgReviewerFeesKobo: Number(feesRow.total_fees_kobo ?? 0) / approvedCount,
  };
}
