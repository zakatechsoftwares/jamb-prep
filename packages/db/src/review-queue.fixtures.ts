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

const TRUNCATED_TABLES = ['subjects', 'users'];

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
  // CASCADE reaches every table referencing these two, which is the whole
  // syllabus, item, review and session graph.
  await client.query(`TRUNCATE ${TRUNCATED_TABLES.join(', ')} CASCADE`);
}

export async function insertReviewer(
  client: PoolClient,
  name: string,
  phone: string,
  subjectIds: number[],
): Promise<{ reviewerId: number; userId: number }> {
  const userId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO users (full_name, phone, exam_year) VALUES ($1, $2, 2026) RETURNING id`,
      [name, phone],
    ),
  ).id;

  const reviewerId = firstRow(
    await client.query<{ id: number }>(
      `INSERT INTO reviewers (user_id, role, status) VALUES ($1, 'reviewer', 'active') RETURNING id`,
      [userId],
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
  gold?: boolean;
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
    await client.query(
      `INSERT INTO gold_items (item_id, reference_decision, reference_key, planted_error_type)
       VALUES ($1, 'reject', 'A', 'wrong_key')`,
      [itemId],
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
