import type { PoolClient } from 'pg';
import type { AuditSampleItem } from '@jamb/shared';

/**
 * A random sample of one reviewer's approvals since `since`, for the
 * moderator's weekly re-review (plan 7.11). `edit_and_approve` counts as an
 * approval — both are the outcomes worth auditing. Never re-samples an
 * item already in `moderator_audits`, and the actual draw is genuine SQL
 * `random()` — this is a real operational sample, not something a caller
 * needs to reproduce deterministically the way a rate-gated draw
 * (`shouldServeGoldItem`) does.
 */
export async function generateModeratorAuditSample(
  client: PoolClient,
  reviewerId: number,
  since: Date,
  count: number,
): Promise<AuditSampleItem[]> {
  const result = await client.query<{ item_id: number; reviewer_id: number; decided_at: Date }>(
    `SELECT rd.item_id, rd.reviewer_id, rd.created_at AS decided_at
       FROM review_decisions rd
      WHERE rd.reviewer_id = $1
        AND rd.action IN ('approve', 'edit_and_approve')
        AND rd.created_at >= $2
        AND NOT EXISTS (SELECT 1 FROM moderator_audits ma WHERE ma.item_id = rd.item_id)
      ORDER BY random()
      LIMIT $3`,
    [reviewerId, since, count],
  );

  return result.rows.map((row) => ({
    itemId: row.item_id,
    reviewerId: row.reviewer_id,
    decidedAt: row.decided_at,
  }));
}

/** Records the moderator's re-review of a sampled item (plan 7.11). */
export async function recordModeratorAudit(
  client: PoolClient,
  itemId: number,
  moderatorId: number,
  agreed: boolean,
  note: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO moderator_audits (item_id, moderator_id, agreed, note) VALUES ($1, $2, $3, $4)`,
    [itemId, moderatorId, agreed, note],
  );
}
