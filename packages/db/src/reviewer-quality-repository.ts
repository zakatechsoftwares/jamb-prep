import type { PoolClient } from 'pg';
import { scoresAgreement, type GoldScoringInput, type OptionLabel } from '@jamb/shared';
import { firstRow } from './first-row';

/**
 * Scores a decision against a gold item's reference, if the item is one
 * (plan 7.11) — records no score row otherwise. Called from
 * `decideOnItem`'s own transaction, right after the decision itself is
 * recorded, for both a `'live'` and a `'late_arrival'` decision alike (a
 * late-arriving second opinion on a gold item is still a genuine accuracy
 * data point).
 *
 * Never surfaced through any reviewer-facing response — the return type is
 * `void` on purpose, so a caller cannot accidentally leak whether an item
 * was gold by echoing this function's result back to the client.
 * `accuracy_score` is recomputed as the plain average of every
 * `gold_item_scores` row this reviewer has ever produced, not incremented
 * — always re-derivable from the audit trail, never subject to
 * floating-point drift from repeated increments.
 *
 * The recompute-and-write of `accuracy_score` runs unconditionally, even
 * when this particular item wasn't gold (it just rewrites the same value,
 * since no new `gold_item_scores` row exists to change it) — deliberately,
 * so that a non-gold decision costs the same number of queries as a gold
 * one save for the one `INSERT`. A reviewer who could measure server-side
 * query count or timing must not be able to use it to infer which items in
 * their own history were gold.
 */
export async function scoreGoldDecision(
  client: PoolClient,
  itemId: number,
  reviewerId: number,
  reviewDecisionId: number,
  actual: GoldScoringInput,
): Promise<void> {
  const reference = (
    await client.query<{
      reference_decision: 'approve' | 'reject' | 'escalate';
      reference_key: OptionLabel;
    }>(`SELECT reference_decision, reference_key FROM gold_items WHERE item_id = $1`, [itemId])
  ).rows[0];

  if (reference) {
    const agreed = scoresAgreement(
      { referenceDecision: reference.reference_decision, referenceKey: reference.reference_key },
      actual,
    );

    await client.query(
      `INSERT INTO gold_item_scores (item_id, reviewer_id, review_decision_id, agreed)
       VALUES ($1, $2, $3, $4)`,
      [itemId, reviewerId, reviewDecisionId, agreed],
    );
  }

  const accuracy = firstRow(
    await client.query<{ accuracy_score: string | null }>(
      `SELECT avg(agreed::int)::numeric(4,3) AS accuracy_score
         FROM gold_item_scores WHERE reviewer_id = $1`,
      [reviewerId],
    ),
  ).accuracy_score;

  await client.query(`UPDATE reviewers SET accuracy_score = $2 WHERE id = $1`, [
    reviewerId,
    accuracy,
  ]);
}
