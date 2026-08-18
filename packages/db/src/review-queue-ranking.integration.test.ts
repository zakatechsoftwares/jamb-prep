import { afterAll, describe, expect, it } from 'vitest';
import {
  ITEM_STATUSES,
  INDEPENDENT_SOLVE_VERDICTS,
  RISK_TIERS,
  priorityOf,
  requiresHumanReview,
  type QueueCandidate,
} from '@jamb/shared';

/**
 * The queue's ranking and filtering exist twice: once as pure TypeScript in
 * @jamb/shared, and once as SQL in the locking query, because concurrency
 * safety cannot be expressed in a pure function. This test drives every
 * combination of the facts either one reads through both and asserts they
 * agree.
 *
 * Without it, a divergence changes which item a reviewer is handed and
 * nothing anywhere else would notice — the queue would simply, quietly,
 * start prioritising the wrong work.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);

interface FactCombination {
  status: (typeof ITEM_STATUSES)[number];
  riskTier: (typeof RISK_TIERS)[number];
  independentSolveVerdict: (typeof INDEPENDENT_SOLVE_VERDICTS)[number];
  gateFlagged: boolean;
  sampledForReview: boolean;
}

function everyCombination(): FactCombination[] {
  const combinations: FactCombination[] = [];

  for (const status of ITEM_STATUSES) {
    for (const riskTier of RISK_TIERS) {
      for (const independentSolveVerdict of INDEPENDENT_SOLVE_VERDICTS) {
        for (const gateFlagged of [false, true]) {
          for (const sampledForReview of [false, true]) {
            combinations.push({
              status,
              riskTier,
              independentSolveVerdict,
              gateFlagged,
              sampledForReview,
            });
          }
        }
      }
    }
  }

  return combinations;
}

function asCandidate(itemId: number, facts: FactCombination): QueueCandidate {
  return {
    itemId,
    subjectId: 1,
    status: facts.status,
    riskTier: facts.riskTier,
    independentSolveVerdict: facts.independentSolveVerdict,
    gateFlagged: facts.gateFlagged,
    sampledForReview: facts.sampledForReview,
    contributorUserId: null,
    decidedByUserIds: [],
    createdAt: new Date(),
  };
}

describe.runIf(hasDatabase)('the SQL queue ranking matches @jamb/shared', () => {
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

  it('agrees on which items are queued and which band each falls into', async () => {
    const { pool } = await import('./client');
    const { seedQueueWorld, insertQueueItem } = await import('./review-queue.fixtures');
    const { QUEUE_PRIORITY_SQL, REQUIRES_HUMAN_REVIEW_SQL } =
      await import('./review-queue-repository');
    const client = await pool.connect();

    try {
      const world = await seedQueueWorld(client);
      const combinations = everyCombination();
      const itemIds: number[] = [];

      for (const facts of combinations) {
        itemIds.push(
          await insertQueueItem(client, world, {
            status: facts.status,
            riskTier: facts.riskTier,
            independentSolveVerdict: facts.independentSolveVerdict,
            gateFlagged: facts.gateFlagged,
            sampledForReview: facts.sampledForReview,
          }),
        );
      }

      const ranked = await client.query<{ id: number; queued: boolean; band: number }>(
        `SELECT i.id,
                (${REQUIRES_HUMAN_REVIEW_SQL}) AS queued,
                ${QUEUE_PRIORITY_SQL} AS band
           FROM items i
          WHERE i.id = ANY($1::bigint[])`,
        [itemIds],
      );

      const bandById = new Map(ranked.rows.map((row) => [row.id, row]));
      const disagreements: string[] = [];

      for (const [index, facts] of combinations.entries()) {
        const itemId = itemIds[index];
        const row = itemId === undefined ? undefined : bandById.get(itemId);

        if (!row) {
          disagreements.push(`no SQL row for ${JSON.stringify(facts)}`);
          continue;
        }

        const candidate = asCandidate(row.id, facts);
        const expectedQueued = requiresHumanReview(candidate);

        if (row.queued !== expectedQueued) {
          disagreements.push(
            `queued: SQL says ${row.queued}, policy says ${expectedQueued} for ${JSON.stringify(facts)}`,
          );
          continue;
        }

        // The CASE evaluates for every row; only queued rows are ever
        // ordered by it, so only those need to agree on a band.
        if (expectedQueued && row.band !== priorityOf(candidate)) {
          disagreements.push(
            `band: SQL says ${row.band}, policy says ${priorityOf(candidate)} for ${JSON.stringify(facts)}`,
          );
        }
      }

      expect(disagreements).toEqual([]);
      // Guards the sweep: if a status, tier or verdict is added and this
      // matrix is not regenerated, the coverage silently shrinks.
      expect(combinations).toHaveLength(
        ITEM_STATUSES.length * RISK_TIERS.length * INDEPENDENT_SOLVE_VERDICTS.length * 4,
      );
    } finally {
      client.release();
    }
  }, 30000);
});
