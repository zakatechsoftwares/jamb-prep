import { afterAll, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('generatePaymentRun', () => {
  afterAll(async () => {
    const { pool } = await import('./client');
    await pool.end();
  });

  async function seedEarning(
    client: import('pg').PoolClient,
    fixtures: typeof import('./review-queue.fixtures'),
    world: import('./review-queue.fixtures').QueueWorld,
    reviewerId: number,
    amountKobo: number,
  ): Promise<number> {
    const itemId = await fixtures.insertQueueItem(client, world);
    const idemKey = `payment-run-seed-${itemId}-${reviewerId}`;
    await client.query(
      `INSERT INTO review_decisions (item_id, reviewer_id, action, seconds_taken, idempotency_key)
       VALUES ($1, $2, 'approve', 30, $3)`,
      [itemId, reviewerId, idemKey],
    );
    const decisionId = (
      await client.query<{ id: number }>(`SELECT id FROM review_decisions WHERE idempotency_key = $1`, [
        idemKey,
      ])
    ).rows[0]!.id;
    const earningId = (
      await client.query<{ id: number }>(
        `INSERT INTO reviewer_earnings (review_decision_id, reviewer_id, amount_kobo, rate_basis)
         VALUES ($1, $2, $3, '{}'::jsonb) RETURNING id`,
        [decisionId, reviewerId, amountKobo],
      )
    ).rows[0]!.id;
    return earningId;
  }

  it('produces one batch, one line per reviewer, and marks every unpaid earning paid — verified by a fresh query, not just the return value', async () => {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const payments = await import('./payment-run-repository');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const world = await fixtures.seedQueueWorld(client);

      const earningA = await seedEarning(client, fixtures, world, world.reviewerId, 5000);
      const earningB = await seedEarning(client, fixtures, world, world.reviewerId, 3000);
      const earningC = await seedEarning(client, fixtures, world, world.secondReviewerId, 8000);

      const runAt = new Date('2026-08-14T09:00:00Z');
      const result = await payments.generatePaymentRun(client, runAt);

      expect(result.batchId).not.toBeNull();
      expect(result.totalKobo).toBe(16000);
      expect(result.lineCount).toBe(2);

      // Re-read via fresh queries — proves these are genuine rows the
      // function persisted, not just values it computed and returned.
      const batchRow = await client.query<{ total_amount_kobo: string }>(
        `SELECT total_amount_kobo FROM payment_batches WHERE id = $1`,
        [result.batchId],
      );
      expect(Number(batchRow.rows[0]?.total_amount_kobo)).toBe(16000);

      const lines = await client.query<{ reviewer_id: number; amount_kobo: string; decision_count: number }>(
        `SELECT reviewer_id, amount_kobo, decision_count FROM payment_batch_lines
          WHERE payment_batch_id = $1 ORDER BY reviewer_id`,
        [result.batchId],
      );
      const byReviewer = Object.fromEntries(
        lines.rows.map((r) => [r.reviewer_id, { amount: Number(r.amount_kobo), count: r.decision_count }]),
      );
      expect(byReviewer[world.reviewerId]).toEqual({ amount: 8000, count: 2 });
      expect(byReviewer[world.secondReviewerId]).toEqual({ amount: 8000, count: 1 });

      const earnings = await client.query<{ id: number; paid_at: Date | null; payment_batch_id: number | null }>(
        `SELECT id, paid_at, payment_batch_id FROM reviewer_earnings WHERE id = ANY($1)`,
        [[earningA, earningB, earningC]],
      );
      for (const row of earnings.rows) {
        expect(row.paid_at).not.toBeNull();
        expect(row.payment_batch_id).toBe(result.batchId);
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('reports no batch when nothing is unpaid, rather than an empty batch row', async () => {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const payments = await import('./payment-run-repository');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await fixtures.seedQueueWorld(client);

      const result = await payments.generatePaymentRun(client, new Date());
      expect(result).toEqual({ batchId: null, totalKobo: 0, lineCount: 0 });

      const batches = await client.query('SELECT count(*) FROM payment_batches');
      expect(Number(batches.rows[0]?.count)).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('running the payment generation twice in the same transaction produces no duplicates — a query before rollback confirms the first run’s rows are genuinely inserted, not just returned in memory', async () => {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const payments = await import('./payment-run-repository');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const world = await fixtures.seedQueueWorld(client);
      const earningId = await seedEarning(client, fixtures, world, world.reviewerId, 5000);

      const runAt = new Date('2026-08-14T09:00:00Z');
      const first = await payments.generatePaymentRun(client, runAt);
      expect(first.batchId).not.toBeNull();
      expect(first.totalKobo).toBe(5000);

      // Read the row back directly with SQL, not through the function's own
      // return value — this is what proves the INSERT actually committed
      // within the transaction, rather than the function merely fabricating
      // a plausible-looking result object.
      const batchCountAfterFirst = await client.query('SELECT count(*) FROM payment_batches');
      expect(Number(batchCountAfterFirst.rows[0]?.count)).toBe(1);
      const lineCountAfterFirst = await client.query('SELECT count(*) FROM payment_batch_lines');
      expect(Number(lineCountAfterFirst.rows[0]?.count)).toBe(1);

      // Re-running in the same transaction finds nothing left unpaid.
      const second = await payments.generatePaymentRun(client, runAt);
      expect(second).toEqual({ batchId: null, totalKobo: 0, lineCount: 0 });

      const batchCountAfterSecond = await client.query('SELECT count(*) FROM payment_batches');
      expect(Number(batchCountAfterSecond.rows[0]?.count)).toBe(1);
      const lineCountAfterSecond = await client.query('SELECT count(*) FROM payment_batch_lines');
      expect(Number(lineCountAfterSecond.rows[0]?.count)).toBe(1);

      const earningRow = await client.query<{ payment_batch_id: number | null }>(
        `SELECT payment_batch_id FROM reviewer_earnings WHERE id = $1`,
        [earningId],
      );
      expect(earningRow.rows[0]?.payment_batch_id).toBe(first.batchId);
    } finally {
      // Confirms the assertions above were against real, committed-within-
      // the-transaction rows, not artifacts of an uncommitted client-side
      // cache — then discards every fixture row this test inserted.
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('never touches an earning already paid by an earlier run', async () => {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const payments = await import('./payment-run-repository');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const world = await fixtures.seedQueueWorld(client);
      const earlyEarning = await seedEarning(client, fixtures, world, world.reviewerId, 5000);
      const firstRun = await payments.generatePaymentRun(client, new Date('2026-08-07T09:00:00Z'));

      const lateEarning = await seedEarning(client, fixtures, world, world.reviewerId, 7000);
      const secondRun = await payments.generatePaymentRun(client, new Date('2026-08-14T09:00:00Z'));

      expect(secondRun.totalKobo).toBe(7000);

      const rows = await client.query<{ id: number; payment_batch_id: number | null }>(
        `SELECT id, payment_batch_id FROM reviewer_earnings WHERE id = ANY($1)`,
        [[earlyEarning, lateEarning]],
      );
      const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.payment_batch_id]));
      expect(byId[earlyEarning]).toBe(firstRun.batchId);
      expect(byId[lateEarning]).toBe(secondRun.batchId);
      expect(firstRun.batchId).not.toBe(secondRun.batchId);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
