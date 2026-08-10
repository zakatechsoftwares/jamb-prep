import type { PoolClient } from 'pg';
import type { PaymentRunResult } from '@jamb/shared';
import { firstRow } from './first-row';

/**
 * The weekly payment run (plan 7.11): pays out every currently-unpaid
 * `reviewer_earnings` row, one `payment_batch_lines` row per reviewer, and
 * marks each earning paid. Insert-only, like the tables it writes to.
 *
 * Idempotent by construction: `SELECT ... FOR UPDATE` locks every unpaid
 * row up front, so a second call within the *same* transaction — the
 * Thursday-by-mistake re-run this is guarding against — finds nothing left
 * unpaid (its own prior UPDATE is already visible) and returns
 * `{ batchId: null, ... }` rather than creating a duplicate batch. The lock
 * also means a concurrent `decideOnItem` inserting a brand new earning
 * mid-run can never be silently swept into a batch whose total was already
 * computed without it.
 */
export async function generatePaymentRun(client: PoolClient, runAt: Date): Promise<PaymentRunResult> {
  const unpaid = await client.query<{ id: number; reviewer_id: number; amount_kobo: string }>(
    `SELECT id, reviewer_id, amount_kobo FROM reviewer_earnings WHERE paid_at IS NULL FOR UPDATE`,
  );

  if (unpaid.rowCount === 0) {
    return { batchId: null, totalKobo: 0, lineCount: 0 };
  }

  const byReviewer = new Map<number, { amountKobo: number; decisionCount: number }>();
  let totalKobo = 0;
  for (const row of unpaid.rows) {
    const amount = Number(row.amount_kobo);
    totalKobo += amount;
    const bucket = byReviewer.get(row.reviewer_id) ?? { amountKobo: 0, decisionCount: 0 };
    bucket.amountKobo += amount;
    bucket.decisionCount += 1;
    byReviewer.set(row.reviewer_id, bucket);
  }

  const batchId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO payment_batches (run_at, total_amount_kobo) VALUES ($1, $2) RETURNING id`,
      [runAt, totalKobo],
    ),
  ).id;

  for (const [reviewerId, { amountKobo, decisionCount }] of byReviewer) {
    await client.query(
      `INSERT INTO payment_batch_lines (payment_batch_id, reviewer_id, amount_kobo, decision_count)
       VALUES ($1, $2, $3, $4)`,
      [batchId, reviewerId, amountKobo, decisionCount],
    );
  }

  await client.query(
    `UPDATE reviewer_earnings SET paid_at = $2, payment_batch_id = $3 WHERE id = ANY($1)`,
    [unpaid.rows.map((row) => row.id), runAt, batchId],
  );

  return { batchId, totalKobo, lineCount: byReviewer.size };
}
