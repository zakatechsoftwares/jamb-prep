import { afterAll, describe, expect, it } from 'vitest';

// Requires a live Postgres with migrations applied (DATABASE_URL). Skipped
// automatically where it isn't set.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('reviewer payment and gold-scoring guards', () => {
  afterAll(async () => {
    const { pool } = await import('./client');
    await pool.end();
  });

  it('rejects rewriting reviewer_earnings.amount_kobo or rate_basis, but allows paying it exactly once', async () => {
    const { pool } = await import('./client');
    const { firstRow } = await import('./first-row');
    const fixtures = await import('./review-queue.fixtures');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const world = await fixtures.seedQueueWorld(client);
      const itemId = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');

      const decisionId = firstRow(
        await client.query<{ id: number }>(
          `SELECT id FROM review_decisions WHERE item_id = $1 AND reviewer_id = $2`,
          [itemId, world.reviewerId],
        ),
      ).id;

      const earningId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO reviewer_earnings (review_decision_id, reviewer_id, amount_kobo, rate_basis)
           VALUES ($1, $2, 5000, '{"configVersion":1,"riskTier":"low","isSecondReview":false}'::jsonb)
           RETURNING id`,
          [decisionId, world.reviewerId],
        ),
      ).id;

      await client.query('SAVEPOINT before_amount_rewrite');
      await expect(
        client.query('UPDATE reviewer_earnings SET amount_kobo = 999999 WHERE id = $1', [
          earningId,
        ]),
      ).rejects.toThrow(/amount_kobo is immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_amount_rewrite');

      await client.query('SAVEPOINT before_rate_basis_rewrite');
      await expect(
        client.query(`UPDATE reviewer_earnings SET rate_basis = '{}'::jsonb WHERE id = $1`, [
          earningId,
        ]),
      ).rejects.toThrow(/rate_basis is immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_rate_basis_rewrite');

      // Paying it: paid_at and payment_batch_id move from NULL to a value —
      // this must be allowed.
      const batchId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO payment_batches (run_at, total_amount_kobo) VALUES (now(), 5000) RETURNING id`,
        ),
      ).id;

      await client.query(
        `UPDATE reviewer_earnings SET paid_at = now(), payment_batch_id = $2 WHERE id = $1`,
        [earningId, batchId],
      );
      const paid = firstRow(
        await client.query<{ paid_at: Date | null; payment_batch_id: number | null }>(
          `SELECT paid_at, payment_batch_id FROM reviewer_earnings WHERE id = $1`,
          [earningId],
        ),
      );
      expect(paid.paid_at).not.toBeNull();
      expect(paid.payment_batch_id).toBe(batchId);

      // But never a second time, or to a different batch — paid_at and
      // payment_batch_id may only be set once, from NULL.
      const otherBatchId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO payment_batches (run_at, total_amount_kobo) VALUES (now(), 5000) RETURNING id`,
        ),
      ).id;

      // now() is constant for the whole transaction, so re-setting paid_at
      // to now() again would be a same-value no-op the guard correctly
      // allows — the rewrite attempt has to target a genuinely different
      // timestamp to actually exercise the guard.
      await client.query('SAVEPOINT before_paid_at_rewrite');
      await expect(
        client.query(
          `UPDATE reviewer_earnings SET paid_at = now() + interval '1 minute' WHERE id = $1`,
          [earningId],
        ),
      ).rejects.toThrow(/paid_at may only be set once/);
      await client.query('ROLLBACK TO SAVEPOINT before_paid_at_rewrite');

      await client.query('SAVEPOINT before_batch_id_rewrite');
      await expect(
        client.query('UPDATE reviewer_earnings SET payment_batch_id = $2 WHERE id = $1', [
          earningId,
          otherBatchId,
        ]),
      ).rejects.toThrow(/payment_batch_id may only be set once/);
      await client.query('ROLLBACK TO SAVEPOINT before_batch_id_rewrite');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects UPDATE and DELETE against payment_batches, payment_batch_lines and gold_item_scores', async () => {
    const { pool } = await import('./client');
    const { firstRow } = await import('./first-row');
    const fixtures = await import('./review-queue.fixtures');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const world = await fixtures.seedQueueWorld(client);
      const itemId = await fixtures.insertQueueItem(client, world);
      await fixtures.insertDecision(client, itemId, world.reviewerId, 'approve');
      const decisionId = firstRow(
        await client.query<{ id: number }>(
          `SELECT id FROM review_decisions WHERE item_id = $1 AND reviewer_id = $2`,
          [itemId, world.reviewerId],
        ),
      ).id;

      const batchId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO payment_batches (run_at, total_amount_kobo) VALUES (now(), 5000) RETURNING id`,
        ),
      ).id;

      const lineId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO payment_batch_lines (payment_batch_id, reviewer_id, amount_kobo, decision_count)
           VALUES ($1, $2, 5000, 1) RETURNING id`,
          [batchId, world.reviewerId],
        ),
      ).id;

      const scoreId = firstRow(
        await client.query<{ id: number }>(
          `INSERT INTO gold_item_scores (item_id, reviewer_id, review_decision_id, agreed)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [itemId, world.reviewerId, decisionId],
        ),
      ).id;

      await client.query('SAVEPOINT before_batch_update');
      await expect(
        client.query('UPDATE payment_batches SET total_amount_kobo = 1 WHERE id = $1', [batchId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_batch_update');

      await client.query('SAVEPOINT before_batch_delete');
      await expect(
        client.query('DELETE FROM payment_batches WHERE id = $1', [batchId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_batch_delete');

      await client.query('SAVEPOINT before_line_update');
      await expect(
        client.query('UPDATE payment_batch_lines SET amount_kobo = 1 WHERE id = $1', [lineId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_line_update');

      await client.query('SAVEPOINT before_line_delete');
      await expect(
        client.query('DELETE FROM payment_batch_lines WHERE id = $1', [lineId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_line_delete');

      await client.query('SAVEPOINT before_score_update');
      await expect(
        client.query('UPDATE gold_item_scores SET agreed = false WHERE id = $1', [scoreId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_score_update');

      await client.query('SAVEPOINT before_score_delete');
      await expect(
        client.query('DELETE FROM gold_item_scores WHERE id = $1', [scoreId]),
      ).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT before_score_delete');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
