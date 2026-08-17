import type { PoolClient } from 'pg';
import { firstRow } from './first-row';

/**
 * Fixtures for the review-queue integration tests.
 *
 * These commit rather than rolling back, because the concurrency test needs
 * twenty separate connections to see the same items — data inside one
 * uncommitted transaction is invisible to all of them. Cleanup is therefore
 * TRUNCATE, which also happens to be the only way to clear the append-only
 * tables: their DELETE triggers reject a DELETE, but TRUNCATE fires
 * TRUNCATE triggers, not row triggers.
 *
 * Takes a client rather than importing the pool, so that importing this
 * module never opens a connection.
 */

// payment_batches has no FK pointing back into the subjects/users graph —
// it's only ever referenced *from* reviewer_earnings/payment_batch_lines,
// never the reverse — so `TRUNCATE subjects, users CASCADE` alone can never
// reach it. Named explicitly so a test that runs a real payment (e.g.
// content-lead-service.integration.test.ts) doesn't leave a batch row that
// pollutes another file's row-count assertions.
const TRUNCATED_TABLES = ['subjects', 'users', 'payment_batches'];

/**
 * Refuses to run a destructive test-cleanup TRUNCATE against a database that
 * isn't obviously disposable. CI (`.github/workflows/ci.yml`) is exempt —
 * its `postgres` service is a fresh container per run, discarded afterward,
 * even though it happens to be named `jamb_prep`, identical to a real local
 * dev database's name. Outside CI, the only name treated as safe is one
 * containing `test`, so a `DATABASE_URL` left pointed at local dev data
 * throws instead of silently wiping it.
 *
 * Exists because this happened for real: running `pnpm test` locally with
 * `DATABASE_URL` pointed at a hand-seeded `jamb_prep` dev database wiped
 * every row in it — schema survived, all data didn't. See
 * `docs/build-log.md`'s "Incident: local dev database wiped by running
 * `pnpm test` against it" for the full account. Every call site that
 * TRUNCATEs for test cleanup calls this first — `truncateQueueWorld` here,
 * plus `reviewer-auth-repository.integration.test.ts` and
 * `apps/api/src/login-end-to-end.integration.test.ts`, which TRUNCATE
 * directly rather than through this fixture.
 */
export async function assertSafeToTruncate(client: PoolClient): Promise<void> {
  if (process.env.CI) {
    return;
  }
  const result = await client.query<{ current_database: string }>('SELECT current_database()');
  const name = result.rows[0]?.current_database ?? '';
  if (!name.toLowerCase().includes('test')) {
    throw new Error(
      `refusing to TRUNCATE: database '${name}' does not look like a disposable test database ` +
        `(expected a name containing 'test', or CI=true). Point DATABASE_URL at a dedicated test ` +
        `database — e.g. jamb_prep_test — instead of a database also used for local dev data.`,
    );
  }
}

export interface QueueWorld {
  subjectId: number;
  otherSubjectId: number;
  objectiveId: number;
  otherObjectiveId: number;
  topicId: number;
  subtopicId: number;
  reviewerId: number;
  reviewerUserId: number;
  secondReviewerId: number;
  secondReviewerUserId: number;
}

export async function truncateQueueWorld(client: PoolClient): Promise<void> {
  await assertSafeToTruncate(client);
  // CASCADE reaches every table referencing these two, which is the whole
  // syllabus, item, review and session graph.
  await client.query(`TRUNCATE ${TRUNCATED_TABLES.join(', ')} CASCADE`);
}

/** Generalised over role, so escalation tests can seed a moderator the same way. */
export async function insertReviewerWithRole(
  client: PoolClient,
  name: string,
  phone: string,
  role: string,
  subjectIds: number[] = [],
): Promise<{ reviewerId: number; userId: number }> {
  const userId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO users (full_name, phone, exam_year) VALUES ($1, $2, 2026) RETURNING id`,
      [name, phone],
    ),
  ).id;

  const reviewerId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO reviewers (user_id, role, status) VALUES ($1, $2, 'active') RETURNING id`,
      [userId, role],
    ),
  ).id;

  for (const subjectId of subjectIds) {
    await client.query(`INSERT INTO reviewer_subjects (reviewer_id, subject_id) VALUES ($1, $2)`, [
      reviewerId,
      subjectId,
    ]);
  }

  return { reviewerId, userId };
}

export async function insertReviewer(
  client: PoolClient,
  name: string,
  phone: string,
  subjectIds: number[],
): Promise<{ reviewerId: number; userId: number }> {
  return insertReviewerWithRole(client, name, phone, 'reviewer', subjectIds);
}

export async function seedQueueWorld(client: PoolClient): Promise<QueueWorld> {
  await truncateQueueWorld(client);

  const subjectId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO subjects (name) VALUES ('Physics') RETURNING id`,
    ),
  ).id;

  const otherSubjectId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO subjects (name) VALUES ('Biology') RETURNING id`,
    ),
  ).id;

  const topicId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO topics (subject_id, name) VALUES ($1, 'Mechanics') RETURNING id`,
      [subjectId],
    ),
  ).id;

  const subtopicId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO subtopics (topic_id, name) VALUES ($1, 'Motion') RETURNING id`,
      [topicId],
    ),
  ).id;

  const objectiveId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO objectives (subtopic_id, description) VALUES ($1, 'Describe motion') RETURNING id`,
      [subtopicId],
    ),
  ).id;

  const otherTopicId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO topics (subject_id, name) VALUES ($1, 'Cells') RETURNING id`,
      [otherSubjectId],
    ),
  ).id;

  const otherSubtopicId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO subtopics (topic_id, name) VALUES ($1, 'Structure') RETURNING id`,
      [otherTopicId],
    ),
  ).id;

  const otherObjectiveId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO objectives (subtopic_id, description) VALUES ($1, 'Describe cells') RETURNING id`,
      [otherSubtopicId],
    ),
  ).id;

  const reviewer = await insertReviewer(client, 'Queue Reviewer', '__queue_reviewer__', [
    subjectId,
  ]);
  const second = await insertReviewer(client, 'Second Reviewer', '__queue_second__', [subjectId]);

  return {
    subjectId,
    otherSubjectId,
    topicId,
    subtopicId,
    objectiveId,
    otherObjectiveId,
    reviewerId: reviewer.reviewerId,
    reviewerUserId: reviewer.userId,
    secondReviewerId: second.reviewerId,
    secondReviewerUserId: second.userId,
  };
}

export interface QueueItemOptions {
  status?: string;
  riskTier?: string;
  independentSolveVerdict?: string;
  sampledForReview?: boolean;
  gateFlagged?: boolean;
  contributorId?: number | null;
  createdAt?: string;
  subjectId?: number;
  objectiveId?: number;
  gold?:
    | boolean
    | { referenceDecision?: string; referenceKey?: string; plantedErrorType?: string | null };
}

export async function insertQueueItem(
  client: PoolClient,
  world: QueueWorld,
  options: QueueItemOptions = {},
): Promise<number> {
  const subjectId = options.subjectId ?? world.subjectId;
  const isOtherSubject = subjectId === world.otherSubjectId;

  const itemId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO items (
         subject_id, topic_id, subtopic_id, objective_id,
         stem, explanation, cognitive_level, expected_time_seconds,
         risk_tier, independent_solve_verdict, sampled_for_review,
         gate_flagged, status, contributor_id, created_at
       ) VALUES ($1, $2, $3, $4, 'stem', 'explanation', 'recall', 60,
                 $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()))
       RETURNING id`,
      [
        subjectId,
        world.topicId,
        world.subtopicId,
        isOtherSubject ? world.otherObjectiveId : (options.objectiveId ?? world.objectiveId),
        options.riskTier ?? 'low',
        options.independentSolveVerdict ?? 'agreed',
        options.sampledForReview ?? true,
        options.gateFlagged ?? false,
        options.status ?? 'pending_review',
        options.contributorId ?? null,
        options.createdAt ?? null,
      ],
    ),
  ).id;

  for (const label of ['A', 'B', 'C', 'D']) {
    await client.query(
      `INSERT INTO item_options (item_id, label, option_text, is_correct)
       VALUES ($1, $2, $3, $4)`,
      [itemId, label, `option ${label}`, label === 'A'],
    );
  }

  if (options.gold) {
    const gold = options.gold === true ? {} : options.gold;
    await client.query(
      `INSERT INTO gold_items (item_id, reference_decision, reference_key, planted_error_type)
       VALUES ($1, $2, $3, $4)`,
      [
        itemId,
        gold.referenceDecision ?? 'reject',
        gold.referenceKey ?? 'A',
        gold.plantedErrorType === undefined ? 'wrong_key' : gold.plantedErrorType,
      ],
    );
  }

  return itemId;
}

/** Records a decision so the item counts as already judged by that reviewer. */
export async function insertDecision(
  client: PoolClient,
  itemId: number,
  reviewerId: number,
  action = 'approve',
): Promise<void> {
  await client.query(
    `INSERT INTO review_decisions (item_id, reviewer_id, action, rejection_reason, seconds_taken, idempotency_key)
     VALUES ($1, $2, $3, $4, 30, $5)`,
    [
      itemId,
      reviewerId,
      action,
      action === 'reject' ? 'wrong_key' : null,
      `decision-${itemId}-${reviewerId}-${action}`,
    ],
  );
}
