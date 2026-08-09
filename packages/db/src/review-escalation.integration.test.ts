import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('resolveEscalation', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      decisions: typeof import('./review-decision-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const decisions = await import('./review-decision-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, decisions });
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

  async function insertModerator(
    client: import('pg').PoolClient,
    fixtures: typeof import('./review-queue.fixtures'),
    phone = '__escalation_moderator__',
  ): Promise<{ reviewerId: number; userId: number }> {
    return fixtures.insertReviewerWithRole(client, 'Escalation Moderator', phone, 'moderator');
  }

  it('approves an escalated item, recording the moderator_ruled route', async () => {
    await withWorld(async ({ client, world, fixtures, decisions }) => {
      const moderator = await insertModerator(client, fixtures);
      const itemId = await fixtures.insertQueueItem(client, world, { status: 'escalated' });

      const result = await decisions.resolveEscalation(moderator.reviewerId, itemId, {
        action: 'approve',
      });

      expect(result).toEqual({
        ok: true,
        itemId,
        status: 'approved_uncalibrated',
        approvalRoute: 'moderator_ruled',
      });

      const row = await client.query<{ status: string; approval_route: string }>(
        `SELECT status, approval_route FROM items WHERE id = $1`,
        [itemId],
      );
      expect(row.rows[0]).toEqual({
        status: 'approved_uncalibrated',
        approval_route: 'moderator_ruled',
      });

      const transitionRow = await client.query<{ approval_route: string; actor_role: string }>(
        `SELECT approval_route, actor_role FROM item_state_transitions
          WHERE item_id = $1 AND event = 'moderator_ruled'`,
        [itemId],
      );
      expect(transitionRow.rows[0]).toEqual({
        approval_route: 'moderator_ruled',
        actor_role: 'moderator',
      });
    });
  });

  it('rejects an escalated item, recording no approval route', async () => {
    await withWorld(async ({ client, world, fixtures, decisions }) => {
      const moderator = await insertModerator(client, fixtures);
      const itemId = await fixtures.insertQueueItem(client, world, { status: 'escalated' });

      const result = await decisions.resolveEscalation(moderator.reviewerId, itemId, {
        action: 'reject',
      });

      expect(result).toEqual({ ok: true, itemId, status: 'rejected', approvalRoute: null });

      const row = await client.query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [
        itemId,
      ]);
      expect(row.rows[0]?.status).toBe('rejected');
    });
  });

  it('refuses to resolve an item that is not currently escalated', async () => {
    await withWorld(async ({ client, world, fixtures, decisions }) => {
      const moderator = await insertModerator(client, fixtures);
      const itemId = await fixtures.insertQueueItem(client, world, { status: 'pending_review' });

      const result = await decisions.resolveEscalation(moderator.reviewerId, itemId, {
        action: 'approve',
      });

      expect(result).toMatchObject({ ok: false, reason: 'invalid_transition' });

      const row = await client.query<{ status: string }>(`SELECT status FROM items WHERE id = $1`, [
        itemId,
      ]);
      expect(row.rows[0]?.status).toBe('pending_review');
    });
  });

  it('refuses to let a non-moderator resolve an escalation, even called directly', async () => {
    // Defense in depth: session 04's guard 5 is enforced inside transition()
    // itself, not only by apps/api's requireModerator middleware — a caller
    // that reaches this function some other way still cannot bypass it.
    await withWorld(async ({ client, world, fixtures, decisions }) => {
      const itemId = await fixtures.insertQueueItem(client, world, { status: 'escalated' });

      const result = await decisions.resolveEscalation(world.reviewerId, itemId, {
        action: 'approve',
      });

      expect(result).toMatchObject({ ok: false, reason: 'invalid_transition' });
      if (result.ok === false && result.reason === 'invalid_transition') {
        expect(result.message).toMatch(/only a moderator/i);
      }
    });
  });

  it('refuses to let a moderator rule on an item they contributed themselves', async () => {
    await withWorld(async ({ client, world, fixtures, decisions }) => {
      const moderator = await insertModerator(client, fixtures);
      const itemId = await fixtures.insertQueueItem(client, world, {
        status: 'escalated',
        contributorId: moderator.userId,
      });

      const result = await decisions.resolveEscalation(moderator.reviewerId, itemId, {
        action: 'approve',
      });

      expect(result).toMatchObject({ ok: false, reason: 'invalid_transition' });
      if (result.ok === false && result.reason === 'invalid_transition') {
        expect(result.message).toMatch(/may not decide on an item they authored/i);
      }
    });
  });

  it('rejects an unrecognised status transition without touching the row when the item does not exist', async () => {
    await withWorld(async ({ fixtures, client, decisions }) => {
      const moderator = await insertModerator(client, fixtures);

      await expect(
        decisions.resolveEscalation(moderator.reviewerId, 999_999, { action: 'approve' }),
      ).rejects.toThrow();
    });
  });
});
